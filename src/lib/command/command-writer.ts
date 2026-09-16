/**
 * コマンド定義ファイルの書き戻し(サーバー専用)
 *
 * 画面から書き換えられるのは `target.editable: true` のファイルの `commands` だけで、
 * `target`(接続先・ユーザー・鍵)はどのファイルでも画面から触れない。
 * **接続先を画面から増やせない**ので、この経路で広がる範囲は
 * 「既に鍵が通っているターゲットで、その鍵のユーザーにできること」に閉じる。
 * ここが編集を許してよいと判断した根拠なので、`target` を書けるようにしてはいけない。
 *
 * 読み込み側(`command-catalog.ts`)が持つ検証はここでは一切複製しない。
 * ファイル内の整合は `scCommandFile`、ファイル横断の整合は `mergeCommandFiles` を
 * そのまま通す。別ロジックで判定すると「保存できたのに一覧に出ない」が生まれる。
 */

import { randomUUID } from 'node:crypto'
import { open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parseDocument, parse as parseYaml } from 'yaml'
import { ClientError } from '../error'
import {
  COMMAND_DEF_CONFLICT,
  COMMAND_DEF_INVALID,
  COMMAND_DEF_NOT_EDITABLE,
  COMMAND_DEF_READ_ONLY,
  type CommandFile,
} from './command'
import {
  clearCommandCatalogCache,
  commandFileRevision,
  listCommandDefFileNames,
  mergeCommandFiles,
  type ParsedCommandFileEntry,
  resolveCommandDefPath,
} from './command-catalog'
import { formatCommandIssues, type ParsedCommandFile, scCommandFile } from './command-def'

/**
 * 書き込みを断った理由。
 *
 * 検証で落ちたときだけ明細(`messages`)を持つ。`errorType` には載せられないので、
 * 呼び出し側が画面向けの形へ詰め替える。
 */
export class CommandDefWriteError extends ClientError {
  // `name` は 'ClientError' のまま継承する。画面側(`parseAction`)がこの名前で
  // 「利用者に見せてよいエラー」を見分けており、変えると想定外エラーの扱いに落ちる
  messages: string[]
  constructor(errorType: string, messages: string[] = []) {
    super(errorType)
    this.messages = messages
  }
}

/** 定義ファイルに書ける 1 件(`targetId` はカタログが入れるので持たない) */
export type CommandDefEntry = CommandFile['commands'][number]

export type EditCommandFileParams = {
  fileName: string
  /**
   * 呼び出し元が権限を確かめたターゲットID。
   *
   * ファイル名はカタログから引いた値だが、その解決はロックの外で行われる。
   * 読み直した現物の `target.id` がこれと違えば、権限を確かめた相手とは別のターゲットなので書かない。
   */
  targetId: string
  /** 画面が見た時点の指紋。ディスクの現物と一致しなければ書かない */
  revision: string
  /** ディスクから読み直した現物を受け取り、書き込む commands を返す */
  apply: (current: ParsedCommandFile) => CommandDefEntry[]
}

/**
 * 同じファイルへの書き込みを直列化する。
 *
 * プロセスをまたぐ競合は `revision` の突き合わせが受け持つ。ロックファイルを置かないのは、
 * プロセスが死んだときの回収が要るうえ、読み取り専用のディレクトリではロックファイル自体を
 * 作れず「編集できない」の判定と混ざるため。
 */
const locks = new Map<string, Promise<unknown>>()
const withFileLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const prev = locks.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  // 失敗が後続を巻き込まないよう、待ち行列には握り潰した Promise を積む
  const queued = next.then(
    () => {},
    () => {},
  )
  locks.set(key, queued)
  void queued.finally(() => {
    if (locks.get(key) === queued) {
      locks.delete(key)
    }
  })
  return next
}

/**
 * errno を画面へ返せる形に翻訳する。
 *
 * read_only でマウントされた config を書こうとすると EROFS。権限不足(EACCES / EPERM)も
 * 運用者が直す先は同じなので同じ案内へ寄せる。それ以外(ENOSPC など)は握らず、
 * 想定外のエラーとして扱う(詳細を画面へ出さない)。
 */
const rethrowWriteError = (error: unknown): never => {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EROFS' || code === 'EACCES' || code === 'EPERM') {
    throw new CommandDefWriteError(COMMAND_DEF_READ_ONLY)
  }
  if (code === 'ENOENT') {
    throw new CommandDefWriteError(COMMAND_DEF_CONFLICT)
  }
  throw error
}

/**
 * 一時ファイルへ書いてから rename で置き換える。
 *
 * rename が守るのはディレクトリエントリだけなので、中身を落としてから差し替える。
 * そうしないと電源断で「rename は済んだが中身が空」が残りうる。
 */
const writeFileAtomic = async (path: string, text: string): Promise<void> => {
  const dir = dirname(path)
  // `.` 始まりにする。`listCommandDefFileNames` が `.` 始まりを除外するので、
  // rename までの中間状態を他プロセスのカタログが拾わない
  const tmpPath = join(dir, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  // 元のパーミッションを引き継ぐ。umask 任せだと 0600 で置かれた定義が保存のたびに緩む
  const mode = await stat(path).then(
    (stats) => stats.mode & 0o777,
    () => 0o644,
  )

  const handle = await open(tmpPath, 'wx', mode).catch(rethrowWriteError)
  try {
    try {
      // open の mode は umask で削られるので明示的に合わせ直す
      await handle.chmod(mode)
      await handle.writeFile(text, 'utf-8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    // 書き切れなかった一時ファイルを残さない。ENOSPC のような障害では
    // 再試行のたびに積み上がり、空きを更に食う
    await rm(tmpPath, { force: true }).catch(() => {})
    rethrowWriteError(error)
  }

  try {
    await rename(tmpPath, path)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    rethrowWriteError(error)
  }

  // ディレクトリエントリ自体の永続化。対応しない環境では失敗するだけなので握り潰す
  const dirHandle = await open(dir, 'r').catch(() => null)
  if (dirHandle) {
    await dirHandle.sync().catch(() => {})
    await dirHandle.close()
  }
}

/**
 * 書いた後のディレクトリを組み立て、自分のファイルが除外されないことを確かめる。
 *
 * 判定は読み込み側と同じ `mergeCommandFiles` に通す。ここで独自に ID の集合を作ると、
 * 除外の条件が読み込み側と食い違ったとき「保存はできたのに一覧に出ない」になる。
 *
 * 今読み込めないファイル(YAML が壊れている等)の ID とは衝突を判定できないが、
 * そのファイルはそもそも読み込まれないので実害が無い。直した時点で両方が除外され、
 * 読み込み側の issues に理由が出る。
 */
const assertMergeable = async (dir: string, fileName: string, next: ParsedCommandFile): Promise<void> => {
  const entries: ParsedCommandFileEntry[] = [{ fileName, file: next, revision: '' }]
  for (const name of listCommandDefFileNames(await readdir(dir))) {
    if (name === fileName) {
      continue
    }
    const text = await readFile(join(dir, name), 'utf-8').catch(() => null)
    if (text === null) {
      continue
    }
    let raw: unknown
    try {
      raw = parseYaml(text)
    } catch {
      continue
    }
    const result = scCommandFile.safeParse(raw)
    if (result.success) {
      entries.push({ fileName: name, file: result.data, revision: '' })
    }
  }

  // 全体の上限は先着で決まるので、読み込み側と同じ名前順に並べてから渡す。
  // 自分を先頭のままにすると、実際には落ちるファイルが通ってしまう
  entries.sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0))

  const { issues } = mergeCommandFiles(entries)
  const mine = issues.find((issue) => issue.fileName === fileName)
  if (mine) {
    throw new CommandDefWriteError(COMMAND_DEF_INVALID, mine.messages)
  }
}

/**
 * 定義ファイルの `commands` だけを差し替える。
 *
 * 差分の当て方を `apply` のコールバックにしてあるのが肝で、当てる相手は**画面が送ってきた配列では
 * なくディスクから読み直した現物**になる。読み込みから書き込みまでが 1 区間に収まるので、
 * 画面が古い一覧を持っていても他人の編集を消さない。
 */
export const editCommandFileCommands = async (
  params: EditCommandFileParams,
): Promise<{ revision: string; commands: CommandDefEntry[] }> => {
  const path = resolveCommandDefPath(params.fileName)
  if (!path) {
    throw new CommandDefWriteError(COMMAND_DEF_INVALID, ['定義ディレクトリ直下のファイル名ではない'])
  }

  return withFileLock(path, async () => {
    // カタログのキャッシュは最大 COMMAND_CATALOG_STAT_INTERVAL_MS 古く、他プロセスが書いた結果は
    // そもそも入っていない。「画面が見たもの」を根拠に書いてはいけないので現物を読み直す
    const text = await readFile(path, 'utf-8').catch(rethrowWriteError)

    if (commandFileRevision(text) !== params.revision) {
      throw new CommandDefWriteError(COMMAND_DEF_CONFLICT)
    }

    // ここで得た doc をそのまま書き戻しに使うので、別に parse した結果と食い違う余地が無い
    const doc = parseDocument(text)
    if (doc.errors.length > 0) {
      throw new CommandDefWriteError(
        COMMAND_DEF_INVALID,
        doc.errors.map((error) => error.message),
      )
    }

    const current = scCommandFile.safeParse(doc.toJS())
    if (!current.success) {
      // 今ディスクにあるものが壊れている。画面経由で上書きすると
      // 「直したつもりが別物になった」になるので、編集そのものを断る
      throw new CommandDefWriteError(COMMAND_DEF_INVALID, formatCommandIssues(current.error))
    }

    // 許可の根拠と書き込み対象は同じ読み出しから採る。
    // そうしないと editable を外した直後の書き込みが通る窓ができる
    if (!current.data.target.editable) {
      throw new CommandDefWriteError(COMMAND_DEF_NOT_EDITABLE)
    }

    // 同じ理由で、ターゲットIDも現物で確かめる。ロックの外で引いたファイル名を信用すると、
    // その間に target.id が差し替わっていた場合、権限の無いターゲットのファイルを書いてしまう
    if (current.data.target.id !== params.targetId) {
      throw new CommandDefWriteError(COMMAND_DEF_CONFLICT)
    }

    doc.set('commands', doc.createNode(params.apply(current.data)))
    // 既定の 80 桁折り返しが入ると長い executable や日本語ラベルが折れて差分が読みにくくなる
    const nextText = doc.toString({ lineWidth: 0 })

    // オブジェクトのまま検証すると、YAML へ書き出す過程で意味が変わった場合
    // (引用漏れ、宙に浮いたアンカー)を見逃すので、生成したテキストを読み直して確かめる
    const written = scCommandFile.safeParse(parseYaml(nextText))
    if (!written.success) {
      throw new CommandDefWriteError(COMMAND_DEF_INVALID, formatCommandIssues(written.error))
    }

    await assertMergeable(dirname(path), params.fileName, written.data)
    await writeFileAtomic(path, nextText)

    // 自プロセスは即時に反映する。他プロセスは rename で inode が変わるため、
    // 指紋(name:mtime:size:ino)が必ず変化して次の stat で拾う
    clearCommandCatalogCache()

    return { revision: commandFileRevision(nextText), commands: written.data.commands }
  })
}
