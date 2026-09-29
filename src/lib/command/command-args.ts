/**
 * 入力値の検証と引数の組み立て(クライアント / サーバー共用の純関数)
 *
 * 画面のフォーム検証とサーバー側の再検証で**同じ関数**を使う。別々に書くと片方だけが緩くなり、
 * 画面を通さない呼び出しで選択肢の外の値が通ってしまう。
 *
 * SSH の exec はリモートのログインシェルに1本の文字列を渡す仕様なので、
 * 「配列で渡したから安全」はローカル側の spawn でしか成立しない。ここでは
 *   1. 値が定義の選択肢に含まれること(`resolveCommandArgs`)。
 *      フリー入力(`type: input`)だけはここが効かないので、文字集合と長さで代わりに縛る
 *   2. 生成された引数が使える文字集合に収まること(`resolveCommandArgs` の最終確認)
 *   3. シングルクォートで包むこと(`shellQuote`)
 * の3つを担当する。リモート側 `authorized_keys` の `command=` 制限が4つ目の層になる。
 */

import { type LocaleValues } from '@/lib/locale-util'
import { el, type LocaleItem } from '@/locale'
import { z } from 'zod'
import {
  COMMAND_FREE_VALUE_PATTERN,
  COMMAND_PLACEHOLDER_PATTERN,
  COMMAND_SENTINEL_MARK,
  COMMAND_START_SENTINEL,
  COMMAND_VALUE_PATTERN,
  type CommandDef,
  type CommandInput,
  type CommandInputValues,
} from './command'
import { type CommandMessage, commandMessage } from './command-message'

/**
 * POSIX シェルの単一引用符クォート。
 *
 * シングルクォートの中では `'` 以外がすべてリテラルになるので、`'` だけを
 * 「閉じる → エスケープした `'` → 開き直す」に置き換えれば任意の文字列を安全に包める。
 */
export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

/**
 * リモートへ渡すコマンド文字列。
 *
 * 先頭に番兵を出すのは、ssh 自身の失敗(接続不可・認証失敗・ホスト鍵不一致)も 255 を返し、
 * リモートコマンドが 255 で終わった場合と区別できないため。番兵を観測していれば
 * リモートで我々のコマンドが起動したことが確定する。
 *
 * `exec` を挟んでラッパーのシェルを残さないことで、ssh を落としたときに
 * 余分なプロセスが残りにくくなる。
 */
export const buildRemoteCommand = (executable: string, args: readonly string[]): string => {
  // printf に解釈させる改行なので、実際の改行ではなくバックスラッシュ + n を渡す
  const sentinel = `printf ${shellQuote(`${COMMAND_SENTINEL_MARK}${COMMAND_START_SENTINEL}\\n`)} >&2`
  // クォートしても PATH 解決は行われるので、実行ファイル名も含めてすべて包む
  const command = [executable, ...args].map(shellQuote).join(' ')
  return `${sentinel}; exec ${command}`
}

/** 番兵行かどうか。ログへ保存する前に落とす */
export const isSentinelLine = (line: string): boolean =>
  line.startsWith(`${COMMAND_SENTINEL_MARK}${COMMAND_START_SENTINEL}`)

/** 入力項目のうち、選択肢を持つもの(checkbox 以外)の選択肢集合 */
const optionValues = (input: CommandInput): Set<string> =>
  'options' in input ? new Set(input.options.map((option) => option.value)) : new Set()

/**
 * 定義から入力フォーム用の zod スキーマを組み立てる。
 *
 * 画面では `zodResolver` に渡し、サーバーでは `resolveCommandArgs` の前段として使う。
 * `strict()` にしているのは、定義に無いキーを黙って捨てず「余分なキーがある」と落とすため。
 */
export const buildCommandInputSchema = (def: CommandDef) => {
  const shape: Record<string, z.ZodType> = {}

  def.inputs.forEach((input) => {
    const values = [...optionValues(input)]
    switch (input.type) {
      case 'select':
      case 'radio': {
        const base = z.enum(values as [string, ...string[]], el('@invalid_command_input'))
        shape[input.key] = input.required ? base : base.or(z.literal('')).optional()
        break
      }
      case 'multiselect': {
        shape[input.key] = z
          .array(z.enum(values as [string, ...string[]], el('@invalid_command_input')))
          .min(input.minSelected, el('@invalid_command_input'))
          .max(input.maxSelected, el('@invalid_command_input'))
        break
      }
      case 'checkbox': {
        shape[input.key] = z.boolean()
        break
      }
      case 'input': {
        const base = z
          .string()
          .regex(COMMAND_FREE_VALUE_PATTERN, el('@invalid_command_value'))
          .max(input.maxLength, el('@invalid_command_value'))
        shape[input.key] = input.required ? base : base.or(z.literal('')).optional()
        break
      }
    }
  })

  return z.object(shape).strict()
}

/** 定義から画面の初期値を作る。フォームのマウント時に使う */
export const buildCommandInputDefaults = (def: CommandDef): CommandInputValues => {
  const values: CommandInputValues = {}
  def.inputs.forEach((input) => {
    switch (input.type) {
      case 'select':
      case 'radio':
        values[input.key] = input.defaultValue ?? (input.required ? (input.options[0]?.value ?? '') : '')
        break
      case 'multiselect':
        values[input.key] = [...input.defaultValues]
        break
      case 'checkbox':
        values[input.key] = input.default
        break
      case 'input':
        values[input.key] = input.defaultValue ?? ''
        break
    }
  })
  return values
}

/**
 * 引数の組み立てに失敗した理由。
 *
 * 実行時にはワーカーからも投げられるので、文言ではなくロケールキーを持たせる。`message` はログ用にキーを入れる。
 */
export class CommandArgsError extends Error {
  static {
    this.prototype.name = 'CommandArgsError'
  }
  detail: CommandMessage
  constructor(item: LocaleItem, values?: LocaleValues) {
    super(item)
    this.detail = commandMessage(item, values)
  }
}

/**
 * 1つの入力項目を引数列へ展開する。
 *
 * 展開結果は**常に配列**にする。select は1要素、multiselect は0個以上、
 * checkbox は `whenTrue` / `whenFalse` をそのまま返すので、呼び出し側で分岐が要らない。
 */
const expandInput = (input: CommandInput, raw: unknown): string[] => {
  switch (input.type) {
    case 'select':
    case 'radio': {
      if (raw === undefined || raw === null || raw === '') {
        if (input.required) {
          throw new CommandArgsError('command_err_arg_required', { key: input.key })
        }
        return []
      }
      if (typeof raw !== 'string' || !optionValues(input).has(raw)) {
        throw new CommandArgsError('command_err_arg_out_of_options', { key: input.key })
      }
      return [raw]
    }
    case 'multiselect': {
      if (!Array.isArray(raw) || raw.some((value) => typeof value !== 'string')) {
        throw new CommandArgsError('command_err_arg_not_string_array', { key: input.key })
      }
      const values = optionValues(input)
      const selected = new Set<string>()
      raw.forEach((value: string) => {
        if (!values.has(value)) {
          throw new CommandArgsError('command_err_arg_out_of_options', { key: input.key })
        }
        selected.add(value)
      })
      if (selected.size < input.minSelected || selected.size > input.maxSelected) {
        throw new CommandArgsError('command_err_arg_count_out_of_range', { key: input.key })
      }
      /**
       * 選択順ではなく**定義の options 順**で並べる。
       * 入力側で順序を決められると、同じ選択でも引数の並びが変わってしまう。
       */
      return input.options.filter((option) => selected.has(option.value)).map((option) => option.value)
    }
    case 'checkbox': {
      if (typeof raw !== 'boolean') {
        throw new CommandArgsError('command_err_arg_not_boolean', { key: input.key })
      }
      return raw ? [...input.whenTrue] : [...input.whenFalse]
    }
    case 'input': {
      if (raw === undefined || raw === null || raw === '') {
        if (input.required) {
          throw new CommandArgsError('command_err_arg_required', { key: input.key })
        }
        return []
      }
      if (typeof raw !== 'string') {
        throw new CommandArgsError('command_err_arg_not_string', { key: input.key })
      }
      // 前後の空白は落とさない。見えない差で渡る値が変わるより、使えない文字として弾く
      if (!COMMAND_FREE_VALUE_PATTERN.test(raw)) {
        throw new CommandArgsError('command_err_arg_invalid_chars', { key: input.key })
      }
      if (raw.length > input.maxLength) {
        throw new CommandArgsError('command_err_arg_too_long', { key: input.key, max: input.maxLength })
      }
      return [raw]
    }
  }
}

/**
 * 入力値から最終的な引数列を組み立てる。
 *
 * 定義側が壊れていても最後の1行で止まるよう、生成し終えた全要素を
 * 改めて `COMMAND_VALUE_PATTERN` で確認する(定義ロード時にも見ているので二重の確認)。
 */
export const resolveCommandArgs = (def: CommandDef, input: CommandInputValues): string[] => {
  const known = new Set(def.inputs.map((item) => item.key))
  Object.keys(input).forEach((key) => {
    if (!known.has(key)) {
      throw new CommandArgsError('command_err_arg_unknown_input', { key })
    }
  })

  const expanded = new Map<string, string[]>()
  def.inputs.forEach((item) => {
    expanded.set(item.key, expandInput(item, input[item.key]))
  })

  const args: string[] = []
  def.args.forEach((token) => {
    const matched = COMMAND_PLACEHOLDER_PATTERN.exec(token)
    if (matched) {
      const values = expanded.get(matched[1])
      if (!values) {
        throw new CommandArgsError('@command_def_undefined_input', { key: matched[1] })
      }
      args.push(...values)
      return
    }
    args.push(token)
  })

  args.forEach((arg) => {
    if (!COMMAND_VALUE_PATTERN.test(arg)) {
      throw new CommandArgsError('@command_def_invalid_arg', { token: arg })
    }
  })

  return args
}

/** 画面と履歴に出す実行内容。秘密(鍵パス・接続先)は含めない */
export const buildArgsPreview = (def: CommandDef, args: readonly string[]): string =>
  [def.executable, ...args].join(' ')
