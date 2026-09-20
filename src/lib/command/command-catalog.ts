/**
 * コマンド定義ファイルの読み込み(サーバー専用)
 *
 * 定義の本体はサーバー上の YAML に置き、画面(DB)では有効化と許可グループだけを持つ。
 * 画面から定義そのものを作れないようにすることで、Web 経由で任意のコマンドを仕込む経路を作らない。
 *
 * 定義は `COMMAND_DEF_DIR` の直下に置いた YAML を**1 ファイル 1 ターゲット**で並べる。
 * ターゲットの追加がファイルの追加になり、ターゲットの単位で足したり消したりできる。
 *
 * キャッシュは stat ベースにしてある。「リロードしろ」を KVS などで全プロセスへ伝播させる代わりに、
 * 各プロセスが自分でディレクトリの中身の変化に追随する。ファイル編集から反映までの遅れは
 * `COMMAND_CATALOG_STAT_INTERVAL_MS` に収まる。
 *
 * 読み込みに失敗したファイルは**そのファイルだけを捨てる**(直前の内容は保持しない)。
 * 古い定義で動き続けると「直したつもりが反映されていない」に気付けないため。
 * ただし 1 ファイルの書き損じで全ターゲットのコマンドが止まるのも困るので、巻き込む範囲はファイル単位に留める。
 */

import { createHash } from 'node:crypto'
import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { envu } from '../env-util'
import { logger } from '../logger'
import {
  COMMAND_CATALOG_STAT_INTERVAL_MS,
  COMMAND_DEF_EXTENSIONS,
  COMMAND_FILE_NAME_PATTERN,
  type CommandDef,
  type CommandTarget,
  compareCommandDefs,
  MAX_COMMAND_DEF_ENTRIES,
  MAX_COMMAND_DEF_FILES,
  MAX_COMMAND_DEFS,
} from './command'
import { formatCommandIssues, type ParsedCommandFile, scCommandFile } from './command-def'

/** 読み込めた定義ファイル 1 件 */
export type CommandCatalogFile = {
  fileName: string
  /** 読み込んだ時点の内容の指紋({@link commandFileRevision})。画面から書き戻すときの突き合わせに使う */
  revision: string
  target: CommandTarget
  commands: CommandDef[]
}

/**
 * ファイルの内容の指紋。
 *
 * 書き戻しの楽観ロックに使う。mtime を使わないのは、秒未満の粒度が潰れる環境があるうえ、
 * `touch` しただけで「変わった」ことになってしまうため。内容が同じなら必ず同じ値になる。
 */
export const commandFileRevision = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16)

/** 読み込めなかった理由。ディレクトリ自体の問題なら `fileName` は null */
export type CommandCatalogIssue = {
  fileName: string | null
  messages: string[]
}

export type CommandCatalog = {
  files: CommandCatalogFile[]
  /** `files` の平坦化。ターゲットIDから引く経路のために持つ */
  targets: CommandTarget[]
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
  /**
   * 定義ディレクトリへ書けるか。
   *
   * `access(2)` はマウントの read-only もマウントフラグとして見て EROFS を返すので、
   * `read_only: true` でバインドマウントされた構成をこれ 1 つで見分けられる。
   * 画面に編集の導線を出すかどうかの判断に使い、実際の可否は書く瞬間に改めて確かめる。
   */
  writable: boolean
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

const emptyCatalog = (): CommandCatalog => ({ files: [], targets: [], commands: [] })

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

type ScanResult = {
  fileNames: string[]
  fingerprint: string
  /** ディレクトリ自体が読めない。カタログは空になる */
  issue?: CommandCatalogIssue
  /** 読み込み自体は続けられるが伝えたいこと。読み込んだ結果の issues へ混ぜる */
  overflowIssues: CommandCatalogIssue[]
}

/**
 * ディレクトリを走査し、対象ファイルの一覧と指紋を作る。
 *
 * 指紋には mtime / size に加えて inode を含める。エディタや配布ツールが「一時ファイルを作って rename」で
 * 置き換える場合、mtime の粒度によっては変化を取りこぼすため。
 *
 * ここで掛けるのは stat の回数を抑える `MAX_COMMAND_DEF_ENTRIES` だけで、読み込むファイル数の上限
 * (`MAX_COMMAND_DEF_FILES`)は `loadCatalog` 側に置く。
 *
 * 上限は**選別と名前順の確定より後**に掛ける。`readdirSync` の並びは順序が保証されないので、
 * 先に掛けると無関係なエントリが多いディレクトリで対象の YAML が落ちる。
 * さらに落ちたファイルは指紋にも入らず、編集しても読み直されなくなる。
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
        overflowIssues: [],
      }
    }
    entries = readdirSync(dir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      fileNames: [],
      fingerprint: 'unreadable',
      issue: { fileName: null, messages: [`定義ディレクトリを読み込めない: ${message}`] },
      overflowIssues: [],
    }
  }

  const targets = listCommandDefFileNames(entries)
  // 指定を誤って巨大なディレクトリを指した場合に、間隔ごとの stat が膨らまないようにする
  const fileNames = targets.slice(0, MAX_COMMAND_DEF_ENTRIES)
  const overflowIssues: CommandCatalogIssue[] =
    targets.length > fileNames.length
      ? [
          {
            fileName: null,
            messages: [
              `定義ファイルが ${targets.length} 件あり、走査の上限 ${MAX_COMMAND_DEF_ENTRIES} 件を超えるため名前順で先頭からしか見ていない`,
            ],
          },
        ]
      : []

  const fingerprint = [
    // 上限を超えたぶんは stat しないので、件数そのものを指紋に入れて増減に追随する。
    // これが無いと上限超過の警告が固着し、超えた側のファイルを消しても消えない
    `count:${targets.length}`,
    ...fileNames.map((fileName) => {
      try {
        // シンボリックリンクを辿って見る。ConfigMap マウントは実体がリンク越しになる
        const stat = statSync(join(dir, fileName))
        return `${fileName}:${stat.mtimeMs}:${stat.size}:${stat.ino}`
      } catch {
        return `${fileName}:missing`
      }
    }),
  ].join('\n')

  return { fileNames, fingerprint, overflowIssues }
}

/** 検証を通った定義ファイル 1 件。`revision` は読み込んだテキストから作る */
export type ParsedCommandFileEntry = { fileName: string; file: ParsedCommandFile; revision: string }

/**
 * 読み込めたファイルを 1 つのカタログへまとめる。
 *
 * ターゲットIDとコマンドIDは**ディレクトリ全体で一意**でなければならない。コマンドIDは実行履歴の
 * `commandKey` と多重実行の占有キーの素になるので、重複したまま片方を採ると
 * 「履歴に残ったキー」と「実際に走った実行ファイル」が食い違う。
 *
 * そのため先勝ち・後勝ちのどちらも採らず、**重複に関与したファイルをすべて除外**する。
 * ファイル名の順で勝敗を決めると、後から書いたタイポのファイルが稼働中のファイルを追い出す事故になる。
 */
export const mergeCommandFiles = (
  parsed: ParsedCommandFileEntry[],
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
  const targetOwners = new Map<string, string[]>()
  const commandOwners = new Map<string, string[]>()
  parsed.forEach(({ fileName, file }) => {
    targetOwners.set(file.target.id, [...(targetOwners.get(file.target.id) ?? []), fileName])
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
  reportDuplicates(targetOwners, 'ターゲットID')
  reportDuplicates(commandOwners, 'コマンドID')

  const files: CommandCatalogFile[] = []
  let total = 0
  parsed.forEach(({ fileName, file, revision }) => {
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
      revision,
      target: file.target,
      // targetId は YAML に書かせず、ここでファイルのターゲットを入れる
      commands: file.commands.map((command) => ({ ...command, targetId: file.target.id })),
    })
  })

  excluded.forEach((messages, fileName) => issues.push({ fileName, messages }))
  issues.sort((a, b) => (a.fileName ?? '').localeCompare(b.fileName ?? ''))

  return {
    catalog: {
      files,
      targets: files.map((file) => file.target),
      // 並びはファイルをまたいで決める。ファイルごとに並べるとファイルの境界で順序が割れる
      commands: files.flatMap((file) => file.commands).sort(compareCommandDefs),
    },
    issues,
  }
}

/** 定義ディレクトリを読み直し、検証する。キャッシュには触らない */
const loadCatalog = (dir: string, fileNames: string[], scanIssues: CommandCatalogIssue[]): CommandCatalogResult => {
  const loadedAt = new Date()
  const issues: CommandCatalogIssue[] = [...scanIssues]
  const parsed: ParsedCommandFileEntry[] = []

  const loadFileNames = fileNames.slice(0, MAX_COMMAND_DEF_FILES)
  fileNames.slice(MAX_COMMAND_DEF_FILES).forEach((fileName) => {
    issues.push({ fileName, messages: [`定義ファイルが上限 ${MAX_COMMAND_DEF_FILES} 件を超えるため読み込まない`] })
  })

  loadFileNames.forEach((fileName) => {
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
    parsed.push({ fileName, file: result.data, revision: commandFileRevision(text) })
  })

  const merged = mergeCommandFiles(parsed)
  return {
    catalog: merged.catalog,
    issues: [...issues, ...merged.issues],
    dir,
    writable: isWritable(dir),
    loadedAt,
  }
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
    ? { catalog: emptyCatalog(), issues: [scanned.issue], dir, writable: false, loadedAt: new Date() }
    : loadCatalog(dir, scanned.fileNames, scanned.overflowIssues)
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

/** プロセス内キャッシュを捨てる。テストと、定義ファイルを書き換えた直後の無効化に使う */
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

/** ターゲットIDから定義を引く。見つからなければ null */
export const findCommandTarget = (targetId: string): CommandTarget | null =>
  getCommandCatalog().catalog.targets.find((target) => target.id === targetId) ?? null

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

/** known_hosts の絶対パス。ターゲットごとの指定が無ければ全体の既定を使う */
export const resolveKnownHostsPath = (target: CommandTarget): string | null => {
  if (target.knownHostsFile) {
    return resolveSshFilePath(target.knownHostsFile)
  }
  const path = envu.server.COMMAND_SSH_KNOWN_HOSTS
  return isAbsolute(path) ? path : resolve(path)
}

/**
 * 定義ファイル名を絶対パスへ解決する。定義ディレクトリの直下でなければ null。
 *
 * 書式(`COMMAND_FILE_NAME_PATTERN`)が既にディレクトリ区切りと `..` を禁じているが、
 * 書き込み先を外へ向けられると被害が大きいので、`resolveSshFilePath` と同じく
 * 解決後のパスが期待どおりかを改めて確かめる。
 */
export const resolveCommandDefPath = (fileName: string): string | null => {
  if (!COMMAND_FILE_NAME_PATTERN.test(fileName)) {
    return null
  }
  if (!(COMMAND_DEF_EXTENSIONS as readonly string[]).includes(extname(fileName).toLowerCase())) {
    return null
  }
  const dir = resolve(envu.server.COMMAND_DEF_DIR)
  const path = resolve(dir, fileName)
  return path === join(dir, fileName) ? path : null
}

/** ディレクトリへ書けるか。read-only マウントは access(2) が EROFS を返すのでここで分かる */
const isWritable = (dir: string): boolean => {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
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
 * 管理画面へ出すターゲットの状態。
 *
 * 接続先ホスト名・ユーザー・鍵のパスは秘密として扱い、準備できているかどうかだけを返す。
 * known_hosts が無いターゲットは fail closed で使用不可になるので、その場で気付けるようにする。
 *
 * `fileName` を載せるのは、読み込めなかったファイルの一覧と突き合わせられるようにするため。
 */
export type CommandTargetStatus = {
  id: string
  label: string
  fileName: string
  /** このターゲットの `commands` を画面から編集してよいか */
  editable: boolean
  /** このターゲットのコマンドで `type: input`(フリー入力)を使ってよいか */
  allowFreeInput: boolean
  /** 画面が見た時点の指紋。書き戻すときにディスクの現物と突き合わせる */
  revision: string
  identityReady: boolean
  knownHostsReady: boolean
}

export const buildCommandTargetStatus = (file: CommandCatalogFile): CommandTargetStatus => ({
  id: file.target.id,
  label: file.target.label,
  fileName: file.fileName,
  editable: file.target.editable,
  allowFreeInput: file.target.allowFreeInput,
  revision: file.revision,
  identityReady: isReadable(resolveSshFilePath(file.target.identityFile)),
  knownHostsReady: isReadable(resolveKnownHostsPath(file.target)),
})
