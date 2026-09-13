/**
 * コマンド定義ファイルの読み込み(サーバー専用)
 *
 * 定義の本体はサーバー上の YAML に置き、画面(DB)では有効化と許可グループだけを持つ。
 * 画面から定義そのものを作れないようにすることで、Web 経由で任意のコマンドを仕込む経路を作らない。
 *
 * キャッシュは stat ベースにしてある。「リロードしろ」を KVS などで全プロセスへ伝播させる代わりに、
 * 各プロセスが自分で mtime / size の変化に追随する。ファイル編集から反映までの遅れは
 * `COMMAND_CATALOG_STAT_INTERVAL_MS` に収まる。
 *
 * 読み込みに失敗したときは**直前の正常な定義を保持しない**(fail closed)。
 * 古い定義で動き続けると「直したつもりが反映されていない」に気付けないため。
 */

import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { envu } from '../env-util'
import { logger } from '../logger'
import { COMMAND_CATALOG_STAT_INTERVAL_MS, compareCommandDefs, type CommandDef, type CommandHost } from './command'
import { formatCommandIssues, scCommandFile } from './command-def'

export type CommandCatalog = {
  hosts: CommandHost[]
  commands: CommandDef[]
}

export type CommandCatalogResult =
  | { ok: true; catalog: CommandCatalog; path: string; loadedAt: Date }
  | { ok: false; issues: string[]; path: string; loadedAt: Date }

type CacheEntry = {
  path: string
  mtimeMs: number
  size: number
  /** 最後に stat を発行した時刻。この間隔の間は stat すら省く */
  checkedAt: number
  result: CommandCatalogResult
}

let cache: CacheEntry | null = null

/** 定義ファイルを読み直し、検証する。キャッシュには触らない */
const loadCatalog = (path: string): CommandCatalogResult => {
  const loadedAt = new Date()

  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, issues: [`定義ファイルを読み込めない: ${message}`], path, loadedAt }
  }

  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, issues: [`YAML として読めない: ${message}`], path, loadedAt }
  }

  const parsed = scCommandFile.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, issues: formatCommandIssues(parsed.error), path, loadedAt }
  }

  const catalog: CommandCatalog = {
    hosts: parsed.data.hosts,
    commands: [...parsed.data.commands].sort(compareCommandDefs),
  }
  return { ok: true, catalog, path, loadedAt }
}

/**
 * 定義ファイルの内容を取得する。
 *
 * `force` を付けると stat の間引きを飛ばして必ず読み直す(管理画面の再読み込みボタン用)。
 */
export const getCommandCatalog = (opts?: { force?: boolean }): CommandCatalogResult => {
  const path = envu.server.COMMAND_DEF_PATH
  const now = Date.now()

  if (!opts?.force && cache && cache.path === path && now - cache.checkedAt < COMMAND_CATALOG_STAT_INTERVAL_MS) {
    return cache.result
  }

  let mtimeMs = 0
  let size = 0
  try {
    const stat = statSync(path)
    mtimeMs = stat.mtimeMs
    size = stat.size
  } catch {
    // 読めない理由は loadCatalog 側の例外文言に任せる。ここでは「変化あり」として扱う
    mtimeMs = -1
    size = -1
  }

  if (!opts?.force && cache && cache.path === path && cache.mtimeMs === mtimeMs && cache.size === size) {
    cache = { ...cache, checkedAt: now }
    return cache.result
  }

  const result = loadCatalog(path)
  cache = { path, mtimeMs, size, checkedAt: now, result }

  if (result.ok) {
    logger.info(
      { path, hosts: result.catalog.hosts.length, commands: result.catalog.commands.length },
      'command catalog loaded',
    )
  } else {
    logger.error({ path, issues: result.issues }, 'command catalog invalid')
  }
  return result
}

/** テスト用。プロセス内キャッシュを捨てる */
export const clearCommandCatalogCache = (): void => {
  cache = null
}

/** 有効な定義だけを引く。機能自体が無効なときは常に空 */
export const listCommandDefs = (): CommandDef[] => {
  if (!envu.server.COMMAND_EXEC_ENABLED) {
    return []
  }
  const result = getCommandCatalog()
  return result.ok ? result.catalog.commands : []
}

/** コマンドキーから定義を引く。見つからなければ null */
export const findCommandDef = (commandKey: string): CommandDef | null =>
  listCommandDefs().find((command) => command.id === commandKey) ?? null

/** ホストIDから定義を引く。見つからなければ null */
export const findCommandHost = (hostId: string): CommandHost | null => {
  const result = getCommandCatalog()
  return result.ok ? (result.catalog.hosts.find((host) => host.id === hostId) ?? null) : null
}

/**
 * 鍵ファイルの絶対パスを解決する。
 *
 * ファイル名の書式(`COMMAND_FILE_NAME_PATTERN`)がディレクトリ区切りと `..` を既に禁じているが、
 * 鍵の置き場所を外へ向けられると被害が大きいので、解決後のパスが `COMMAND_SSH_DIR` の下に
 * あることを改めて確かめる。
 */
export const resolveSshFilePath = (fileName: string): string | null => {
  const dir = resolve(envu.server.COMMAND_SSH_DIR)
  const path = resolve(dir, fileName)
  if (path !== dir && !path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`)) {
    logger.error({ fileName }, 'ssh file path escapes COMMAND_SSH_DIR')
    return null
  }
  return path
}

/** known_hosts の絶対パス。ホストごとの指定が無ければ全体の既定を使う */
export const resolveKnownHostsPath = (host: CommandHost): string | null => {
  if (host.knownHostsFile) {
    return resolveSshFilePath(host.knownHostsFile)
  }
  const path = envu.server.COMMAND_SSH_KNOWN_HOSTS
  return isAbsolute(path) ? path : resolve(path)
}

/** ファイルが読めるか。管理画面には真偽値だけを出し、パスそのものは見せない */
const isReadable = (path: string | null): boolean => {
  if (!path) {
    return false
  }
  try {
    accessSync(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 管理画面へ出すホストの状態。
 *
 * 接続先ホスト名・ユーザー・鍵のパスは秘密として扱い、準備できているかどうかだけを返す。
 * known_hosts が無いホストは fail closed で使用不可になるので、その場で気付けるようにする。
 */
export type CommandHostStatus = {
  id: string
  label: string
  identityReady: boolean
  knownHostsReady: boolean
}

export const buildCommandHostStatus = (host: CommandHost): CommandHostStatus => ({
  id: host.id,
  label: host.label,
  identityReady: isReadable(resolveSshFilePath(host.identityFile)),
  knownHostsReady: isReadable(resolveKnownHostsPath(host)),
})
