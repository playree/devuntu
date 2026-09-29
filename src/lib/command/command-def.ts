/**
 * コマンド定義ファイル(YAML)のスキーマ(クライアント / サーバー共用)
 *
 * エラーメッセージは `@` 始まりのロケールキー(`el()`)で持ち、差し込む値は custom issue の `params` に入れる。
 * 文字列にするのは表示側(`formatCommandMessage`)で、ここでは `CommandMessage` へ詰め替えるまでを受け持つ。
 * 利用者の入力に対するスキーマは `command-args.ts` が定義から動的に組み立てる。
 *
 * 検証の目的は「壊れた定義を読み込まないこと」に加えて、
 * **実行時に選択肢の外の値が引数へ入る余地を、定義の段階で潰しておくこと**にある。
 */

import { el } from '@/locale'
import { z } from 'zod'
import {
  COMMAND_DEF_VERSION,
  COMMAND_FILE_NAME_PATTERN,
  COMMAND_FREE_INPUT_MAX_LEN_DEFAULT,
  COMMAND_FREE_VALUE_PATTERN,
  COMMAND_ID_PATTERN,
  COMMAND_MULTISELECT_MAX_DEFAULT,
  COMMAND_PLACEHOLDER_LOOSE_PATTERN,
  COMMAND_PLACEHOLDER_PATTERN,
  COMMAND_TARGET_KINDS,
  COMMAND_TIMEOUT_DEFAULT_SEC,
  COMMAND_TIMEOUT_MAX_SEC,
  COMMAND_TIMEOUT_MIN_SEC,
  COMMAND_VALUE_MAX_LEN,
  COMMAND_VALUE_PATTERN,
  type CommandInput,
  MAX_COMMAND_ARGS,
  MAX_COMMAND_DEFS_PER_FILE,
  MAX_COMMAND_INPUTS,
  MAX_COMMAND_OPTIONS,
} from './command'
import { type CommandMessage, commandMessage, commandText } from './command-message'

export const zCommandId = z.string().regex(COMMAND_ID_PATTERN, el('@command_def_invalid_id'))
const zLabel = z.string().min(1).max(120)
const zOptionValue = z.string().regex(COMMAND_VALUE_PATTERN, el('@command_def_invalid_option_value'))
const zFreeValue = z.string().regex(COMMAND_FREE_VALUE_PATTERN, el('@command_def_invalid_free_value'))
const zFileName = z.string().regex(COMMAND_FILE_NAME_PATTERN, el('@command_def_invalid_file_name'))

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
  /**
   * フリー入力。`target.allowFreeInput: true` のファイルでしか使えない(`scCommandFile` が見る)。
   *
   * 選択肢の閉包が効かない唯一の種別なので、値は `COMMAND_FREE_VALUE_PATTERN` と `maxLength` で縛る。
   */
  z.strictObject({
    type: z.literal('input'),
    key: zCommandId,
    label: zLabel,
    defaultValue: zFreeValue.optional(),
    /** 入力欄に薄く出す例。値ではないので文字集合は縛らない */
    placeholder: z.string().max(60).optional(),
    required: z.boolean().default(true),
    maxLength: z.number().int().min(1).max(COMMAND_VALUE_MAX_LEN).default(COMMAND_FREE_INPUT_MAX_LEN_DEFAULT),
  }),
])

const scCommandTarget = z.strictObject({
  id: zCommandId,
  label: zLabel,
  /** v1 は ssh のみ。ホスト側実行もコンテナ内実行も SSH 経由で表現する */
  kind: z.enum(COMMAND_TARGET_KINDS).default('ssh'),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(22),
  user: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/, el('@command_def_invalid_user')),
  /** COMMAND_SSH_DIR 配下のファイル名のみ。パスは書かせない */
  identityFile: zFileName,
  /** 省略時は COMMAND_SSH_KNOWN_HOSTS を使う */
  knownHostsFile: zFileName.optional(),
  /**
   * `commands` を画面から編集してよいか。
   *
   * 既定は false で、書けるのは**このファイルを直に置ける人**だけ。つまり編集の許可は
   * ファイルシステムを触れる運用者が名指しで与えるものになる。`target` 自体はこの値に関わらず
   * 画面から変えられないので、編集を許しても画面から到達できる接続先は増えない。
   */
  editable: z.boolean().default(false),
  /**
   * このターゲットのコマンドで `type: input`(フリー入力)を使ってよいか。
   *
   * 既定は false。フリー入力は「選択肢の閉包」が効かない唯一の経路なので、
   * リモート側に実行ゲート(`authorized_keys` の `command=`)を置いたホストだけで開ける想定にしてある。
   * `target` は画面から編集できないため、この許可も画面からは増やせない。
   */
  allowFreeInput: z.boolean().default(false),
})

const scCommandDef = z
  .strictObject({
    id: zCommandId,
    label: zLabel,
    description: z.string().max(500).optional(),
    /** 絶対パス推奨。リモート側のシェルに解釈させる余地を減らすため文字集合を絞る */
    executable: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/, el('@command_def_invalid_executable')),
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
   * コマンド 1 件の中で閉じた整合。
   *
   * ファイル全体ではなくここに置くのは、**画面から 1 件だけを編集するときにも同じ検証を効かせる**ため。
   * `scCommandDefInput` はこのスキーマそのものなので、ここに無いものは保存を試みるまで気付けない。
   */
  .superRefine((command, ctx) => {
    const inputKeys = new Set<string>()
    command.inputs.forEach((input, index) => {
      if (inputKeys.has(input.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['inputs', index, 'key'],
          message: el('@command_def_duplicate_input_key'),
          params: { key: input.key },
        })
      }
      inputKeys.add(input.key)
      checkInputDefaults(input, ctx, ['inputs', index])
    })

    checkArgTokens(command.args, inputKeys, ctx, ['args'])
    // checkbox の展開結果も引数としてそのまま渡るので、プレースホルダを書けないことを固定する
    command.inputs.forEach((input, index) => {
      if (input.type === 'checkbox') {
        checkArgTokens(input.whenTrue, new Set(), ctx, ['inputs', index, 'whenTrue'])
        checkArgTokens(input.whenFalse, new Set(), ctx, ['inputs', index, 'whenFalse'])
      }
    })
  })

/**
 * 定義ファイル 1 件。
 *
 * **1 ファイルに 1 ターゲット**で、そのファイルのコマンドはすべてこのターゲットで動く。
 * コマンド側に `targetId` を書かないのは、書ける形にすると「どのファイルのターゲットで動くのか」が
 * ファイルを開いただけでは分からなくなるため。ターゲットとコマンドの対応はファイルの境界で決まる。
 *
 * コマンド 1 件の中で閉じた整合(入力キーの重複、既定値、プレースホルダの対応)は `scCommandDef` が見る。
 * ここで見るのはファイル単位でしか分からない整合(コマンドIDの重複)だけ。
 * ファイルをまたぐ整合(ターゲットID・コマンドIDの重複)は `command-catalog.ts` が見る。
 */
export const scCommandFile = z
  .strictObject({
    version: z.literal(COMMAND_DEF_VERSION),
    target: scCommandTarget,
    commands: z.array(scCommandDef).max(MAX_COMMAND_DEFS_PER_FILE).default([]),
  })
  .superRefine((file, ctx) => {
    const commandIds = new Set<string>()
    file.commands.forEach((command, index) => {
      if (commandIds.has(command.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['commands', index, 'id'],
          message: el('@command_def_duplicate_command_id'),
          params: { id: command.id },
        })
      }
      commandIds.add(command.id)

      /**
       * フリー入力の許可はターゲット側にあるので、コマンド 1 件のスキーマでは見られない。
       * 画面からの保存もファイル全体をこのスキーマへ通すため、判定はここ 1 か所で足りる。
       */
      if (!file.target.allowFreeInput) {
        command.inputs.forEach((input, inputIndex) => {
          if (input.type === 'input') {
            ctx.addIssue({
              code: 'custom',
              path: ['commands', index, 'inputs', inputIndex, 'type'],
              message: el('@command_def_free_input_not_allowed'),
            })
          }
        })
      }
    })
  })

/** 既定値が選択肢の中にあるか。定義した本人が気付けないまま「既定値が消える」のを防ぐ */
const checkInputDefaults = (input: CommandInput, ctx: z.RefinementCtx, path: (string | number)[]): void => {
  if (input.type === 'select' || input.type === 'radio') {
    if (input.defaultValue && !input.options.some((option) => option.value === input.defaultValue)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'defaultValue'],
        message: el('@command_def_default_not_in_options'),
        params: { value: input.defaultValue },
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
          message: el('@command_def_default_not_in_options'),
          params: { value },
        })
      }
    })
    if (input.minSelected > input.maxSelected) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'minSelected'],
        message: el('@command_def_min_over_max'),
      })
    }
    // 満たせる選択が存在しない定義。読み込めてしまうと実行できないコマンドが一覧に出る
    if (input.minSelected > input.options.length) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'minSelected'],
        message: el('@command_def_min_over_options'),
      })
    }
    return
  }
  if (input.type === 'input') {
    if (input.defaultValue && input.defaultValue.length > input.maxLength) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'defaultValue'],
        message: el('@command_def_default_too_long'),
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
          message: el('@command_def_undefined_input'),
          params: { key: matched[1] },
        })
      }
      return
    }
    if (COMMAND_PLACEHOLDER_LOOSE_PATTERN.test(token)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, index],
        message: el('@command_def_partial_placeholder'),
        params: { token },
      })
      return
    }
    if (!COMMAND_VALUE_PATTERN.test(token)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, index],
        message: el('@command_def_invalid_arg'),
        params: { token },
      })
    }
  })
}

/**
 * 書けない項目の説明。
 *
 * 未知キーは黙って捨てず弾くが、廃止した項目は「書けない」だけだと直し方が分からないので理由まで出す。
 */
const UNKNOWN_KEY_REASONS: Record<string, CommandMessage> = {
  host: commandMessage('command_err_unknown_key_host'),
  hostId: commandMessage('command_err_unknown_key_target_ref', { key: 'hostId' }),
  targetId: commandMessage('command_err_unknown_key_target_ref', { key: 'targetId' }),
  hosts: commandMessage('command_err_unknown_key_hosts'),
}

/** 未知キー1件ぶんの説明。位置を自前で示せる側(エディタの lint)はキーごとに引ける */
export const unknownKeyMessage = (key: string): CommandMessage =>
  (Object.hasOwn(UNKNOWN_KEY_REASONS, key) ? UNKNOWN_KEY_REASONS[key] : undefined) ??
  commandMessage('command_err_unknown_key', { key })

/**
 * issue の「なぜ」の部分。
 *
 * 未知キーの issue は path がオブジェクトの位置までしか無く、キー名は `keys` にしか入らないので、
 * キーごとに 1 件へ分ける。`@` 始まりはこのモジュールが入れたロケールキーで、それ以外は zod の既定文。
 */
export const commandIssueMessages = (issue: z.core.$ZodIssue): CommandMessage[] => {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map(unknownKeyMessage)
  }
  if (issue.message.startsWith('@')) {
    return [commandMessage(issue.message as ReturnType<typeof el>, issue.code === 'custom' ? issue.params : undefined)]
  }
  return [commandText(issue.message)]
}

/** zod の issue を「どこが」「なぜ」だけの形にする。管理画面へそのまま出す */
export const formatCommandIssues = (error: z.ZodError): CommandMessage[] =>
  error.issues.flatMap((issue) => {
    const path = issue.path.join('.')
    return commandIssueMessages(issue).map((message) => (path ? { ...message, path } : message))
  })

/* -------------------------------------------------------------------------------------------------
 * 画面から 1 件を編集するための入り口
 *
 * 定義ファイルに書ける 1 件と画面から送る 1 件は同じ形なので、`scCommandDef` をそのまま使う。
 * 別のスキーマを起こすと、項目を増やしたときに片方だけ直して食い違う。
 * -----------------------------------------------------------------------------------------------*/

/** 画面から送る 1 コマンドぶんの定義 */
export const scCommandDefInput = scCommandDef

/**
 * 検証済みの定義ファイル。
 *
 * `command.ts` の手書きの型(`CommandFile`)と食い違うと `command-catalog.ts` の
 * 戻り値の代入でコンパイルエラーになる。型の定義元は `command.ts` 側に置き、
 * ここはスキーマの出力として派生させる。
 */
export type ParsedCommandFile = z.infer<typeof scCommandFile>
