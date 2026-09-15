/**
 * コマンド定義ファイル(YAML)のスキーマ(クライアント / サーバー共用)
 *
 * ここで検証するのは運用者が書く定義ファイルであって、利用者の入力ではない。
 * そのためエラーメッセージにロケールキー(`el()`)は使わず、原因がそのまま読める文言を入れる。
 * 利用者の入力に対するスキーマは `command-args.ts` が定義から動的に組み立てる。
 *
 * 検証の目的は「壊れた定義を読み込まないこと」に加えて、
 * **実行時に選択肢の外の値が引数へ入る余地を、定義の段階で潰しておくこと**にある。
 */

import { z } from 'zod'
import {
  COMMAND_DEF_VERSION,
  COMMAND_FILE_NAME_PATTERN,
  COMMAND_HOST_KINDS,
  COMMAND_ID_PATTERN,
  COMMAND_MULTISELECT_MAX_DEFAULT,
  COMMAND_PLACEHOLDER_LOOSE_PATTERN,
  COMMAND_PLACEHOLDER_PATTERN,
  COMMAND_TIMEOUT_DEFAULT_SEC,
  COMMAND_TIMEOUT_MAX_SEC,
  COMMAND_TIMEOUT_MIN_SEC,
  COMMAND_VALUE_PATTERN,
  type CommandInput,
  MAX_COMMAND_ARGS,
  MAX_COMMAND_DEFS_PER_FILE,
  MAX_COMMAND_INPUTS,
  MAX_COMMAND_OPTIONS,
} from './command'

const zCommandId = z
  .string()
  .regex(COMMAND_ID_PATTERN, '識別子は英数字で始まる 2〜64 文字(英小文字・数字・_・-)で指定する')
const zLabel = z.string().min(1).max(120)
const zOptionValue = z.string().regex(COMMAND_VALUE_PATTERN, '選択肢の値に使えない文字が含まれている')
const zFileName = z
  .string()
  .regex(COMMAND_FILE_NAME_PATTERN, 'ファイル名は英数字で始まる 1〜64 文字で指定する(ディレクトリ区切りは不可)')

/** 引数テンプレートの1要素。丸ごとプレースホルダか、固定文字列のどちらか */
const zArgToken = z.string().min(1).max(500)

const scCommandOption = z.strictObject({
  value: zOptionValue,
  label: zLabel,
})

const scSelectLike = z.strictObject({
  key: zCommandId,
  label: zLabel,
  options: z.array(scCommandOption).min(1).max(MAX_COMMAND_OPTIONS),
  defaultValue: zOptionValue.optional(),
  required: z.boolean().default(true),
})

const scCommandInput = z.discriminatedUnion('type', [
  scSelectLike.extend({ type: z.literal('select') }),
  scSelectLike.extend({ type: z.literal('radio') }),
  z.strictObject({
    type: z.literal('multiselect'),
    key: zCommandId,
    label: zLabel,
    options: z.array(scCommandOption).min(1).max(MAX_COMMAND_OPTIONS),
    defaultValues: z.array(zOptionValue).default([]),
    minSelected: z.number().int().min(0).default(0),
    maxSelected: z.number().int().min(1).default(COMMAND_MULTISELECT_MAX_DEFAULT),
  }),
  z.strictObject({
    type: z.literal('checkbox'),
    key: zCommandId,
    label: zLabel,
    default: z.boolean().default(false),
    /** チェック時に展開される引数。値ではなく完成形を持たせることで部分埋め込みを不要にする */
    whenTrue: z.array(zArgToken).max(MAX_COMMAND_ARGS).default([]),
    whenFalse: z.array(zArgToken).max(MAX_COMMAND_ARGS).default([]),
  }),
])

const scCommandHost = z.strictObject({
  id: zCommandId,
  label: zLabel,
  /** v1 は ssh のみ。ホスト側実行もコンテナ内実行も SSH 経由で表現する */
  kind: z.enum(COMMAND_HOST_KINDS).default('ssh'),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(22),
  user: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/, 'ユーザー名の書式が不正'),
  /** COMMAND_SSH_DIR 配下のファイル名のみ。パスは書かせない */
  identityFile: zFileName,
  /** 省略時は COMMAND_SSH_KNOWN_HOSTS を使う */
  knownHostsFile: zFileName.optional(),
})

const scCommandDef = z.strictObject({
  id: zCommandId,
  label: zLabel,
  description: z.string().max(500).optional(),
  /** 絶対パス推奨。リモート側のシェルに解釈させる余地を減らすため文字集合を絞る */
  executable: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/, '実行ファイルのパスに使えない文字が含まれている'),
  args: z.array(zArgToken).max(MAX_COMMAND_ARGS).default([]),
  inputs: z.array(scCommandInput).max(MAX_COMMAND_INPUTS).default([]),
  timeoutSec: z
    .number()
    .int()
    .min(COMMAND_TIMEOUT_MIN_SEC)
    .max(COMMAND_TIMEOUT_MAX_SEC)
    .default(COMMAND_TIMEOUT_DEFAULT_SEC),
  requireConfirm: z.boolean().default(true),
  confirmText: z.string().max(300).optional(),
  /** 破壊的なコマンドだけが opt-in する。常時強制すると日常運用で使われなくなる */
  requireFreshSession: z.boolean().default(false),
  /** 同じコマンドの同時実行を禁止するか */
  singleton: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

/**
 * 定義ファイル 1 件。
 *
 * **1 ファイルに 1 ホスト**で、そのファイルのコマンドはすべてこのホストで動く。
 * コマンド側に `hostId` を書かないのは、書ける形にすると「どのファイルのホストで動くのか」が
 * ファイルを開いただけでは分からなくなるため。ホストとコマンドの対応はファイルの境界で決まる。
 *
 * 個々のフィールドの検証を通ったあとに、ファイル内で閉じた整合(id の重複、
 * プレースホルダの対応)を `superRefine` でまとめて見る。
 * ファイルをまたぐ整合(ホストID・コマンドIDの重複)は `command-catalog.ts` が見る。
 */
export const scCommandFile = z
  .strictObject({
    version: z.literal(COMMAND_DEF_VERSION),
    host: scCommandHost,
    commands: z.array(scCommandDef).max(MAX_COMMAND_DEFS_PER_FILE).default([]),
  })
  .superRefine((file, ctx) => {
    const commandIds = new Set<string>()
    file.commands.forEach((command, index) => {
      const at = (...path: (string | number)[]) => ['commands', index, ...path]

      if (commandIds.has(command.id)) {
        ctx.addIssue({ code: 'custom', path: at('id'), message: `コマンドID ${command.id} が重複している` })
      }
      commandIds.add(command.id)

      const inputKeys = new Set<string>()
      command.inputs.forEach((input, inputIndex) => {
        if (inputKeys.has(input.key)) {
          ctx.addIssue({
            code: 'custom',
            path: at('inputs', inputIndex, 'key'),
            message: `入力項目のキー ${input.key} が重複している`,
          })
        }
        inputKeys.add(input.key)
        checkInputDefaults(input, ctx, at('inputs', inputIndex))
      })

      checkArgTokens(command.args, inputKeys, ctx, at('args'))
      // checkbox の展開結果も引数としてそのまま渡るので、プレースホルダを書けないことを固定する
      command.inputs.forEach((input, inputIndex) => {
        if (input.type === 'checkbox') {
          checkArgTokens(input.whenTrue, new Set(), ctx, at('inputs', inputIndex, 'whenTrue'))
          checkArgTokens(input.whenFalse, new Set(), ctx, at('inputs', inputIndex, 'whenFalse'))
        }
      })
    })
  })

/** 既定値が選択肢の中にあるか。定義した本人が気付けないまま「既定値が消える」のを防ぐ */
const checkInputDefaults = (input: CommandInput, ctx: z.RefinementCtx, path: (string | number)[]): void => {
  if (input.type === 'select' || input.type === 'radio') {
    if (input.defaultValue && !input.options.some((option) => option.value === input.defaultValue)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'defaultValue'],
        message: `既定値 ${input.defaultValue} が選択肢に無い`,
      })
    }
    return
  }
  if (input.type === 'multiselect') {
    const values = new Set(input.options.map((option) => option.value))
    input.defaultValues.forEach((value, index) => {
      if (!values.has(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'defaultValues', index],
          message: `既定値 ${value} が選択肢に無い`,
        })
      }
    })
    if (input.minSelected > input.maxSelected) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'minSelected'],
        message: 'minSelected が maxSelected を超えている',
      })
    }
    // 満たせる選択が存在しない定義。読み込めてしまうと実行できないコマンドが一覧に出る
    if (input.minSelected > input.options.length) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'minSelected'],
        message: 'minSelected が選択肢の数を超えている',
      })
    }
  }
}

/**
 * 引数テンプレートの検証。
 *
 * プレースホルダは**要素まるごと**でなければならない。`--flag={{env}}` のような部分埋め込みを許すと、
 * 値との境界が曖昧になるうえ、multiselect のような多値をどう展開すべきか定義できない。
 * `--flag=production` が必要なら選択肢側に完成形(`whenTrue: ['--flag=production']` など)を持たせる。
 */
const checkArgTokens = (
  args: string[],
  inputKeys: Set<string>,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void => {
  args.forEach((token, index) => {
    const matched = COMMAND_PLACEHOLDER_PATTERN.exec(token)
    if (matched) {
      if (!inputKeys.has(matched[1])) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, index],
          message: `未定義の入力項目 ${matched[1]} を参照している`,
        })
      }
      return
    }
    if (COMMAND_PLACEHOLDER_LOOSE_PATTERN.test(token)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, index],
        message: `プレースホルダは要素全体でのみ使える(${token})。値と結合したい場合は選択肢側に完成形を持たせる`,
      })
      return
    }
    if (!COMMAND_VALUE_PATTERN.test(token)) {
      ctx.addIssue({ code: 'custom', path: [...path, index], message: `引数に使えない文字が含まれている(${token})` })
    }
  })
}

/**
 * 書けない項目の説明。
 *
 * 未知キーは黙って捨てず弾くが、廃止した項目は「書けない」だけだと直し方が分からないので理由まで出す。
 */
const UNKNOWN_KEY_REASONS: Record<string, string> = {
  hostId: 'ホストは定義ファイル単位で決まるため commands[].hostId は書けない',
  hosts: 'hosts の配列は書けない。1 ファイルに 1 ホストを host へ書く',
}

/**
 * zod の issue を「どこが」「なぜ」だけの1行にする。管理画面へそのまま出す。
 *
 * 未知キーの issue は path がオブジェクトの位置までしか無く、キー名は `keys` にしか入らないので、
 * ここで本文へ混ぜ直す。
 */
export const formatCommandIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => {
    const path = issue.path.join('.')
    const message =
      issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) => UNKNOWN_KEY_REASONS[key] ?? `書けない項目 ${key} がある`).join(' / ')
        : issue.message
    return path ? `${path}: ${message}` : message
  })

/**
 * 検証済みの定義ファイル。
 *
 * `command.ts` の手書きの型(`CommandFile`)と食い違うと `command-catalog.ts` の
 * 戻り値の代入でコンパイルエラーになる。型の定義元は `command.ts` 側に置き、
 * ここはスキーマの出力として派生させる。
 */
export type ParsedCommandFile = z.infer<typeof scCommandFile>
