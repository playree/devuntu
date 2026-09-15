/**
 * コマンド定義ファイルの読み込み(サーバー専用)
 *
 * 定義の本体はサーバー上の YAML に置き、画面(DB)では有効化と許可グループだけを持つ。
 * 画面から定義そのものを作れないようにすることで、Web 経由で任意のコマンドを仕込む経路を作らない。
 *
 * 定義は `COMMAND_DEF_DIR` の直下に置いた YAML を**1 ファイル 1 ホスト**で並べる。
 * ホストの追加がファイルの追加になり、ホスト単位で足したり消したりできる。
 *
 * キャッシュは stat ベースにしてある。「リロードしろ」を KVS などで全プロセスへ伝播させる代わりに、
 * 各プロセスが自分でディレクトリの中身の変化に追随する。ファイル編集から反映までの遅れは
 * `COMMAND_CATALOG_STAT_INTERVAL_MS` に収まる。
 *
 * 読み込みに失敗したファイルは**そのファイルだけを捨てる**(直前の内容は保持しない)。
 * 古い定義で動き続けると「直したつもりが反映されていない」に気付けないため。
 * ただし 1 ファイルの書き損じで全ホストのコマンドが止まるのも困るので、巻き込む範囲はファイル単位に留める。
 */

import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { envu } from '../env-util'
import { logger } from '../logger'
import {
  COMMAND_CATALOG_STAT_INTERVAL_MS,
  COMMAND_DEF_EXTENSIONS,
  type CommandDef,
  type CommandHost,
  compareCommandDefs,
  MAX_COMMAND_DEF_ENTRIES,
  MAX_COMMAND_DEF_FILES,
  MAX_COMMAND_DEFS,
} from './command'
import { formatCommandIssues, type ParsedCommandFile, scCommandFile } from './command-def'

/** 読み込めた定義ファイル 1 件 */
export type CommandCatalogFile = {
  fileName: string
  host: CommandHost
  commands: CommandDef[]
}

/** 読み込めなかった理由。ディレクトリ自体の問題なら `fileName` は null */
export type CommandCatalogIssue = {
  fileName: string | null
  messages: string[]
}

export type CommandCatalog = {
  files: CommandCatalogFile[]
  /** `files` の平坦化。ホストIDから引く経路のために持つ */
  hosts: CommandHost[]
  /** `files` の平坦化。並びはファイルをまたいで `compareCommandDefs` で決める */
  commands: CommandDef[]
}

/**
 * 読み込みの結果。
 *
 * 「全部成功」か「全部失敗」かの二択にはしない。壊れたファイルを除いた分は使えるので、
 * 使える定義(`catalog`)と使えなかった理由(`issues`)を必ず両方返す。
 */
export type CommandCatalogResult = {
  catalog: CommandCatalog
  issues: CommandCatalogIssue[]
  dir: string
  loadedAt: Date
}

type CacheEntry = {
  dir: string
  /** ディレクトリの中身の指紋。ファイル名の並びを含めることで削除にも追随する */
  fingerprint: string
  /** 最後に stat を発行した時刻。この間隔の間は stat すら省く */
  checkedAt: number
  result: CommandCatalogResult
}

let cache: CacheEntry | null = null

const emptyCatalog = (): CommandCatalog => ({ files: [], hosts: [], commands: [] })

/**
 * 定義ファイルとして読む名前を選ぶ。
 *
 * `.` で始まるものを落とすのは、エディタのロックファイル(`.#foo.yaml`、実体の無いシンボリックリンク)や
 * ConfigMap マウントの `..data` を踏まないため。
 */
export const listCommandDefFileNames = (entries: string[]): string[] =>
  entries
    .filter((name) => !name.startsWith('.'))
    .filter((name) => (COMMAND_DEF_EXTENSIONS as readonly string[]).includes(extname(name).toLowerCase()))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

type ScanResult = { fileNames: string[]; fingerprint: string; issue?: CommandCatalogIssue }

/**
 * ディレクトリを走査し、対象ファイルの一覧と指紋を作る。
 *
 * 指紋には mtime / size に加えて inode を含める。エディタや配布ツールが「一時ファイルを作って rename」で
 * 置き換える場合、mtime の粒度によっては変化を取りこぼすため。
 *
 * ファイル数の上限はここでは掛けない。指紋を上限適用後のリストで作ると、
 * 上限を超えたファイルを足しても指紋が変わらず、警告が永久に出なくなる。
 */
const scanDir = (dir: string): ScanResult => {
  let entries: string[]
  try {
    const stat = statSync(dir)
    if (!stat.isDirectory()) {
      return {
        fileNames: [],
        fingerprint: 'not-a-directory',
        issue: { fileName: null, messages: ['COMMAND_DEF_DIR にはディレクトリを指定する(ファイルは指定できない)'] },
      }
    }
    entries = readdirSync(dir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      fileNames: [],
      fingerprint: 'unreadable',
      issue: { fileName: null, messages: [`定義ディレクトリを読み込めない: ${message}`] },
    }
  }

  // 指定を誤って巨大なディレクトリを指した場合に、間隔ごとの stat が膨らまないようにする
  const fileNames = listCommandDefFileNames(entries.slice(0, MAX_COMMAND_DEF_ENTRIES))

  const fingerprint = fileNames
    .map((fileName) => {
      try {
        // シンボリックリンクを辿って見る。ConfigMap マウントは実体がリンク越しになる
        const stat = statSync(join(dir, fileName))
        return `${fileName}:${stat.mtimeMs}:${stat.size}:${stat.ino}`
      } catch {
        return `${fileName}:missing`
      }
    })
    .join('\n')

  return { fileNames, fingerprint }
}

/**
 * 読み込めたファイルを 1 つのカタログへまとめる。
 *
 * ホストIDとコマンドIDは**ディレクトリ全体で一意**でなければならない。コマンドIDは実行履歴の
 * `commandKey` と多重実行の占有キーの素になるので、重複したまま片方を採ると
 * 「履歴に残ったキー」と「実際に走った実行ファイル」が食い違う。
 *
 * そのため先勝ち・後勝ちのどちらも採らず、**重複に関与したファイルをすべて除外**する。
 * ファイル名の順で勝敗を決めると、後から書いたタイポのファイルが稼働中のファイルを追い出す事故になる。
 */
export const mergeCommandFiles = (
  parsed: { fileName: string; file: ParsedCommandFile }[],
): { catalog: CommandCatalog; issues: CommandCatalogIssue[] } => {
  const issues: CommandCatalogIssue[] = []
  const excluded = new Map<string, string[]>()
  const exclude = (fileName: string, message: string) => {
    const messages = excluded.get(fileName)
    if (messages) {
      messages.push(message)
      return
    }
    excluded.set(fileName, [message])
  }

  // 誰と誰がぶつかっているかを先に確定させる。除外した結果で別のファイルが復活すると、
  // 同じ内容でも処理順によって結果が変わってしまう
  const hostOwners = new Map<string, string[]>()
  const commandOwners = new Map<string, string[]>()
  parsed.forEach(({ fileName, file }) => {
    hostOwners.set(file.host.id, [...(hostOwners.get(file.host.id) ?? []), fileName])
    file.commands.forEach((command) => {
      commandOwners.set(command.id, [...(commandOwners.get(command.id) ?? []), fileName])
    })
  })

  const reportDuplicates = (owners: Map<string, string[]>, what: string) => {
    owners.forEach((fileNames, id) => {
      if (fileNames.length < 2) {
        return
      }
      fileNames.forEach((fileName) => {
        const others = fileNames.filter((other) => other !== fileName)
        exclude(fileName, `${what} ${id} が ${others.join(' / ')} と重複している`)
      })
    })
  }
  reportDuplicates(hostOwners, 'ホストID')
  reportDuplicates(commandOwners, 'コマンドID')

  const files: CommandCatalogFile[] = []
  let total = 0
  parsed.forEach(({ fileName, file }) => {
    if (excluded.has(fileName)) {
      return
    }
    // 全体の上限。ファイルの途中で切ると「一部のコマンドだけ消える」になるのでファイル単位で落とす
    if (total + file.commands.length > MAX_COMMAND_DEFS) {
      exclude(fileName, `コマンドの合計が上限 ${MAX_COMMAND_DEFS} 件を超えるため読み込まない`)
      return
    }
    total += file.commands.length
    files.push({
      fileName,
      host: file.host,
      // hostId は YAML に書かせず、ここでファイルのホストを入れる
      commands: file.commands.map((command) => ({ ...command, hostId: file.host.id })),
    })
  })

  excluded.forEach((messages, fileName) => issues.push({ fileName, messages }))
  issues.sort((a, b) => (a.fileName ?? '').localeCompare(b.fileName ?? ''))

  return {
    catalog: {
      files,
      hosts: files.map((file) => file.host),
      // 並びはファイルをまたいで決める。ファイルごとに並べるとファイルの境界で順序が割れる
      commands: files.flatMap((file) => file.commands).sort(compareCommandDefs),
    },
    issues,
  }
}

/** 定義ディレクトリを読み直し、検証する。キャッシュには触らない */
const loadCatalog = (dir: string, fileNames: string[]): CommandCatalogResult => {
  const loadedAt = new Date()
  const issues: CommandCatalogIssue[] = []
  const parsed: { fileName: string; file: ParsedCommandFile }[] = []

  const targets = fileNames.slice(0, MAX_COMMAND_DEF_FILES)
  fileNames.slice(MAX_COMMAND_DEF_FILES).forEach((fileName) => {
    issues.push({ fileName, messages: [`定義ファイルが上限 ${MAX_COMMAND_DEF_FILES} 件を超えるため読み込まない`] })
  })

  targets.forEach((fileName) => {
    let text: string
    try {
      text = readFileSync(join(dir, fileName), 'utf-8')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      issues.push({ fileName, messages: [`定義ファイルを読み込めない: ${message}`] })
      return
    }

    let raw: unknown
    try {
      raw = parseYaml(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      issues.push({ fileName, messages: [`YAML として読めない: ${message}`] })
      return
    }

    const result = scCommandFile.safeParse(raw)
    if (!result.success) {
      issues.push({ fileName, messages: formatCommandIssues(result.error) })
      return
    }
    parsed.push({ fileName, file: result.data })
  })

  const merged = mergeCommandFiles(parsed)
  return { catalog: merged.catalog, issues: [...issues, ...merged.issues], dir, loadedAt }
}

/**
 * 定義ディレクトリの内容を取得する。
 *
 * `force` を付けると stat の間引きを飛ばして必ず読み直す(管理画面の再読み込みボタン用)。
 */
export const getCommandCatalog = (opts?: { force?: boolean }): CommandCatalogResult => {
  const dir = resolve(envu.server.COMMAND_DEF_DIR)
  const now = Date.now()

  if (!opts?.force && cache && cache.dir === dir && now - cache.checkedAt < COMMAND_CATALOG_STAT_INTERVAL_MS) {
    return cache.result
  }

  // 走査 → 読み込み → キャッシュの順を崩さない。読み込みの後で指紋を採ると、
  // 読み込み中に書き換わったファイルの新しい指紋と古い内容を組にして永久に古いままになる
  const scanned = scanDir(dir)

  if (!opts?.force && cache && cache.dir === dir && cache.fingerprint === scanned.fingerprint) {
    cache = { ...cache, checkedAt: now }
    return cache.result
  }

  const result = scanned.issue
    ? { catalog: emptyCatalog(), issues: [scanned.issue], dir, loadedAt: new Date() }
    : loadCatalog(dir, scanned.fileNames)
  cache = { dir, fingerprint: scanned.fingerprint, checkedAt: now, result }

  logger.info(
    { dir, files: result.catalog.files.length, commands: result.catalog.commands.length },
    'command catalog loaded',
  )
  if (result.issues.length > 0) {
    logger.error({ dir, issues: result.issues }, 'command catalog has unreadable files')
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
  return getCommandCatalog().catalog.commands
}

/** コマンドキーから定義を引く。見つからなければ null */
export const findCommandDef = (commandKey: string): CommandDef | null =>
  listCommandDefs().find((command) => command.id === commandKey) ?? null

/** ホストIDから定義を引く。見つからなければ null */
export const findCommandHost = (hostId: string): CommandHost | null =>
  getCommandCatalog().catalog.hosts.find((host) => host.id === hostId) ?? null

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
 *
 * `fileName` を載せるのは、読み込めなかったファイルの一覧と突き合わせられるようにするため。
 */
export type CommandHostStatus = {
  id: string
  label: string
  fileName: string
  identityReady: boolean
  knownHostsReady: boolean
}

export const buildCommandHostStatus = (file: CommandCatalogFile): CommandHostStatus => ({
  id: file.host.id,
  label: file.host.label,
  fileName: file.fileName,
  identityReady: isReadable(resolveSshFilePath(file.host.identityFile)),
  knownHostsReady: isReadable(resolveKnownHostsPath(file.host)),
})
