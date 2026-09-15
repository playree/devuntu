/**
 * コマンド実行の共通定義(クライアント / サーバー共用)
 *
 * NOTE: このファイルはクライアント('use client')からも import されるため、
 * `node:` モジュールや環境変数を持ち込まない。定義ファイルの読み込みは `command-catalog.ts`、
 * 引数の組み立ては `command-args.ts` に置く。
 */

/** 定義ファイルの形式バージョン。互換性を壊す変更を入れるときに上げる */
export const COMMAND_DEF_VERSION = 1

/**
 * コマンド / ホスト / 入力項目の識別子。
 * 英数字始まりに固定し、`..` のような相対パス片が紛れ込めないようにする。
 */
export const COMMAND_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/

/**
 * 選択肢の値として許す文字集合。
 *
 * 最終的にリモートのログインシェルへ渡る文字列なので、引用が破れても意味を持たない文字だけに絞る。
 * 空白・引用符・ドル記号・バッククォート・セミコロン・パイプ・リダイレクト・括弧・改行はすべて含めない。
 */
export const COMMAND_VALUE_PATTERN = /^[A-Za-z0-9._:@=/+,-]{1,200}$/

/**
 * 鍵ファイル / known_hosts のファイル名。
 *
 * 英数字始まりに固定することで `.` や `..` のような名前を弾き、
 * ディレクトリ区切りを含めないことで `COMMAND_SSH_DIR` の外を指せないようにする。
 */
export const COMMAND_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** 引数テンプレートのプレースホルダ。要素まるごとが二重波括弧の場合だけ一致する */
export const COMMAND_PLACEHOLDER_PATTERN = /^\{\{([a-z0-9][a-z0-9_-]{1,63})\}\}$/

/** 部分埋め込み(`--flag={{env}}` のような書き方)を検出するための緩いパターン */
export const COMMAND_PLACEHOLDER_LOOSE_PATTERN = /\{\{.*?\}\}/

/** 実行先の種別。v1 は SSH のみで、ホスト側実行もコンテナ内実行も SSH 経由で表現する */
export const COMMAND_HOST_KINDS = ['ssh'] as const
export type CommandHostKind = (typeof COMMAND_HOST_KINDS)[number]

/** 入力項目の種別。フリー入力は型として存在させない */
export const COMMAND_INPUT_TYPES = ['select', 'radio', 'multiselect', 'checkbox'] as const
export type CommandInputType = (typeof COMMAND_INPUT_TYPES)[number]

/** タイムアウトの範囲と既定 */
export const COMMAND_TIMEOUT_MIN_SEC = 5
export const COMMAND_TIMEOUT_MAX_SEC = 3600
export const COMMAND_TIMEOUT_DEFAULT_SEC = 900

/** 定義 1 件あたりの上限。壊れた定義でメモリや画面が溢れないようにする */
export const MAX_COMMAND_INPUTS = 20
export const MAX_COMMAND_OPTIONS = 200
export const MAX_COMMAND_ARGS = 50

/** 読み込む定義ファイルの数の上限(1 ファイル 1 ホストなのでホスト数の上限でもある) */
export const MAX_COMMAND_DEF_FILES = 100

/** 1 ファイルに書けるコマンドの数の上限。スキーマ側で見る */
export const MAX_COMMAND_DEFS_PER_FILE = 100

/** ディレクトリ全体で読み込むコマンドの数の上限。ファイルをまたぐのでマージ後に見る */
export const MAX_COMMAND_DEFS = 200

/**
 * 走査するディレクトリエントリ数の上限。
 *
 * 指定を誤って巨大なディレクトリを指した場合に、間隔ごとに数万回の stat が走るのを防ぐ。
 */
export const MAX_COMMAND_DEF_ENTRIES = 500

/** 定義ファイルとして読む拡張子 */
export const COMMAND_DEF_EXTENSIONS = ['.yaml', '.yml'] as const

/** multiselect で選べる数の上限の既定 */
export const COMMAND_MULTISELECT_MAX_DEFAULT = 20

/**
 * 定義ファイルの再読み込みを検討する間隔。
 *
 * この間隔を過ぎたときだけ stat を発行し、mtime / size が変わっていれば読み直す。
 * ファイルを編集してから全プロセスへ反映されるまでの遅れがこの値になる。
 */
export const COMMAND_CATALOG_STAT_INTERVAL_MS = 1000

/**
 * リモート側が我々のコマンドを起動したことを示す番兵の本文。
 *
 * ssh は接続不可・認証失敗・ホスト鍵不一致でも 255 を返すため、
 * これを観測したかどうかでリモートコマンドの終了コードと区別する。
 * 前置きの区切り文字は通常の出力に現れない制御文字(RS)を使う。
 */
export const COMMAND_START_SENTINEL = 'devuntu-start'

/** 番兵行の区切り文字(RS: record separator) */
export const COMMAND_SENTINEL_MARK = '\u001e'

/* -------------------------------------------------------------------------------------------------
 * 実行時の定数
 * -----------------------------------------------------------------------------------------------*/

/** ワーカーの tick 間隔。実行の立ち上がりを速くしたいので通知より短くする */
export const COMMAND_TICK_MS = 2_000

/** ワーカー起動から最初の tick までの待ち。起動直後の負荷と重ねない */
export const COMMAND_START_DELAY_MS = 5_000

/** ログをまとめて書き出す間隔。1秒あたりの INSERT 回数の上限を決める */
export const COMMAND_FLUSH_INTERVAL_MS = 250

/** ログをまとめて書き出すサイズ。間隔より先に達したらその時点で書く */
export const COMMAND_FLUSH_BYTES = 8 * 1024

/**
 * 保存するログの上限。
 *
 * 超えても**実行は続ける**。ログが長いだけの正常なジョブを殺さないため、
 * 保存だけを止めて `truncated` を立てる。
 */
export const COMMAND_MAX_OUTPUT_BYTES = 2 * 1024 * 1024

/** 明らかな暴走とみなして kill する出力量 */
export const COMMAND_RUNAWAY_BYTES = 32 * 1024 * 1024

/** 保存するチャンク数の上限 */
export const COMMAND_MAX_CHUNKS = 5_000

/** 生存申告の間隔 */
export const COMMAND_HEARTBEAT_MS = 5_000

/** これを超えて生存申告が無い running は、掴んだプロセスが落ちたとみなす */
export const COMMAND_STALE_MS = 60_000

/** 中断要求から SIGTERM までの猶予(リモートが stdin の EOF で自分から降りるのを待つ) */
export const COMMAND_ABORT_GRACE_MS = 5_000

/** SIGTERM から SIGKILL までの猶予 */
export const COMMAND_KILL_GRACE_MS = 5_000

/** ログの書き出しに連続で失敗したら実行を打ち切る回数 */
export const COMMAND_FLUSH_MAX_RETRIES = 3

/** 実行の終了状態。ここに入ったら以降 status は変わらない */
export const COMMAND_TERMINAL_STATUSES = ['succeeded', 'failed', 'canceled'] as const

/** 実行の状態。Prisma の enum と同じ並びで持つ(tests で一致を固定する) */
export const COMMAND_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const
export type CommandRunStatusValue = (typeof COMMAND_RUN_STATUSES)[number]

/** 履歴一覧で並べ替えできる列。想定外の列名は既定へ落とす */
export const COMMAND_RUN_SORT_COLUMNS = ['queuedAt', 'finishedAt', 'commandLabel', 'status', 'userName'] as const
export type CommandRunSortColumn = (typeof COMMAND_RUN_SORT_COLUMNS)[number]

/** 履歴一覧の1ページの既定件数 */
export const COMMAND_RUN_ROWS_PER_PAGE = 20

/** 打ち切りの分類。画面には出さずログと履歴の絞り込みに使う */
export const COMMAND_FAILURE_KINDS = [
  /** 定義の timeoutSec を超えた */
  'timeout',
  /** 画面から中断された */
  'canceled',
  /** アプリの再起動などで掴んだプロセスが消えた */
  'interrupted',
  /** 出力が暴走した */
  'output_limit',
  /** ssh 自身が失敗した(接続不可・認証失敗・ホスト鍵不一致) */
  'ssh_error',
  /** 接続が途中で切れた */
  'connection_lost',
  /** ログを保存できなかった */
  'log_write_failed',
  /** ssh プロセスを起動できなかった */
  'start_failed',
] as const
export type CommandFailureKind = (typeof COMMAND_FAILURE_KINDS)[number]

/* -------------------------------------------------------------------------------------------------
 * SSE(実行ログのライブ配信)
 *
 * 配信は DB のポーリングだけで完全に成立する。プロセス内の合図(`command-signal.ts`)は
 * 遅延を縮めるだけの最適化なので、届かなくても表示が遅れるだけで欠落は起きない。
 * -----------------------------------------------------------------------------------------------*/

/** 未読が無いときに次を見に行くまでの待ち。合図が来ればこれより早く起きる */
export const COMMAND_SSE_POLL_MS = 1_000

/** 無音が続いたときにコメント行を流す間隔。proxy のアイドル切断を避ける */
export const COMMAND_SSE_HEARTBEAT_MS = 15_000

/** 1接続の最大寿命。超えたら閉じて張り直させる(Last-Event-ID で続きから再開できる) */
export const COMMAND_SSE_MAX_MS = 30 * 60 * 1000

/** クライアントへ指示する再接続待ち */
export const COMMAND_SSE_RETRY_MS = 2_000

/** 1回の読み出しで返すチャンク数 */
export const COMMAND_SSE_PAGE = 500

/* -------------------------------------------------------------------------------------------------
 * 画面へ返すエラーコード
 *
 * 画面側の分岐で使うため、prisma を持ち込む `command-run.ts` ではなくここに置く
 * (クライアントバンドルに fs / dns が引きずり込まれてしまうため)。
 * -----------------------------------------------------------------------------------------------*/

/** 同じコマンドが既に動いている */
export const COMMAND_ALREADY_RUNNING = 'COMMAND_ALREADY_RUNNING'

/** 順番待ちが上限に達している */
export const COMMAND_QUEUE_FULL = 'COMMAND_QUEUE_FULL'

/** ホスト定義。identityFile などの秘密は画面にも API 応答にも出さない */
export type CommandHost = {
  id: string
  label: string
  kind: CommandHostKind
  host: string
  port: number
  user: string
  identityFile: string
  knownHostsFile?: string
}

/** 選択肢 */
export type CommandOption = {
  value: string
  label: string
}

/** 入力項目 */
export type CommandInput =
  | { type: 'select'; key: string; label: string; options: CommandOption[]; defaultValue?: string; required: boolean }
  | { type: 'radio'; key: string; label: string; options: CommandOption[]; defaultValue?: string; required: boolean }
  | {
      type: 'multiselect'
      key: string
      label: string
      options: CommandOption[]
      defaultValues: string[]
      minSelected: number
      maxSelected: number
    }
  | { type: 'checkbox'; key: string; label: string; default: boolean; whenTrue: string[]; whenFalse: string[] }

/** コマンド定義 */
export type CommandDef = {
  id: string
  label: string
  description?: string
  /** YAML には書かない。1 ファイル 1 ホストなので、カタログがそのファイルの host.id を入れる */
  hostId: string
  executable: string
  args: string[]
  inputs: CommandInput[]
  timeoutSec: number
  requireConfirm: boolean
  confirmText?: string
  requireFreshSession: boolean
  singleton: boolean
  sortOrder: number
}

/** 定義ファイル 1 件。ホストは 1 ファイルに 1 つで、そのファイルのコマンドはすべてこのホストで動く */
export type CommandFile = {
  version: number
  host: CommandHost
  /** ファイルの中では hostId を書かないので、その分だけ型を落とす */
  commands: Omit<CommandDef, 'hostId'>[]
}

/** 入力値。フリー入力が無いので文字列 / 文字列配列 / 真偽値しか取らない */
export type CommandInputValues = Record<string, string | string[] | boolean>

/** 定義の並び順。sortOrder の昇順、同値なら label・id の昇順で安定させる */
export const compareCommandDefs = (a: CommandDef, b: CommandDef): number =>
  a.sortOrder - b.sortOrder || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
