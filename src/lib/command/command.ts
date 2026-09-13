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
export const MAX_COMMAND_HOSTS = 100
export const MAX_COMMAND_DEFS = 200

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

/** 定義ファイル全体 */
export type CommandFile = {
  version: number
  hosts: CommandHost[]
  commands: CommandDef[]
}

/** 入力値。フリー入力が無いので文字列 / 文字列配列 / 真偽値しか取らない */
export type CommandInputValues = Record<string, string | string[] | boolean>

/** 定義の並び順。sortOrder の昇順、同値なら label・id の昇順で安定させる */
export const compareCommandDefs = (a: CommandDef, b: CommandDef): number =>
  a.sortOrder - b.sortOrder || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
