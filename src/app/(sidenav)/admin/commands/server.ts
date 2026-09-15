'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { assertFreshSession } from '@/lib/auth/session-fresh'
import { COMMAND_DEF_CONFLICT, type CommandDef } from '@/lib/command/command'
import { effectiveSortOrder } from '@/lib/command/command-access'
import { buildCommandTargetStatus, type CommandTargetStatus, getCommandCatalog } from '@/lib/command/command-catalog'
import { scDeleteCommandDef, scUpsertCommandDef } from '@/lib/command/command-def'
import {
  defaultCommandSetting,
  deleteCommandSetting,
  getCommandSettings,
  setCommandSetting,
} from '@/lib/command/command-settings'
import { type CommandDefEntry, CommandDefWriteError, editCommandFileCommands } from '@/lib/command/command-writer'
import { envu } from '@/lib/env-util'
import { errInvalidOperation, errTooManyRequests } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit } from '@/lib/rate-limit'
import { scUpdateCommandSetting } from '@/lib/schema/schema'

/** 定義の再読み込みは I/O を伴うので、連打で叩き続けられないようにする */
const RELOAD_RATE_LIMIT = { limit: 10, windowMs: 60_000 }

/** 定義ファイルの書き換えは I/O とディレクトリの全走査を伴うので、連打で叩けないようにする */
const EDIT_RATE_LIMIT = { limit: 20, windowMs: 60_000 }

/**
 * 画面へ出す 1 コマンドぶんの情報。
 *
 * 接続先(ホスト名・ユーザー・鍵のパス)は秘密として扱い、ホストの表示名だけを載せる。
 */
export type CommandDefView = {
  id: string
  label: string
  description: string | null
  targetId: string
  targetLabel: string | null
  executable: string
  args: string[]
  inputs: { type: CommandDef['inputs'][number]['type']; key: string; label: string; optionCount: number }[]
  timeoutSec: number
  requireConfirm: boolean
  requireFreshSession: boolean
  singleton: boolean
  /** 画面で編集する設定。定義ファイル側の sortOrder はここで上書きされる */
  setting: { enabled: boolean; sortOrder: number; allowedGroupIds: string[] }
  /** このコマンドが書かれているファイル。編集の宛先になる */
  fileName: string
  /** 画面が見た時点のファイルの指紋。保存時にディスクの現物と突き合わせる */
  revision: string
  /** そのファイルが `target.editable: true` か */
  editable: boolean
  /**
   * 編集画面へ渡す定義の現物。編集できないファイルでは null。
   *
   * 秘密(接続先・鍵)は `target` 側にあり、ここには入らない。
   */
  source: CommandDefEntry | null
}

const toDefView = (
  def: CommandDef,
  file: { fileName: string; revision: string; editable: boolean; label: string },
  setting: { enabled: boolean; sortOrder: number; allowedGroupIds: string[] },
): CommandDefView => ({
  id: def.id,
  label: def.label,
  description: def.description ?? null,
  targetId: def.targetId,
  targetLabel: file.label,
  executable: def.executable,
  args: def.args,
  inputs: def.inputs.map((input) => ({
    type: input.type,
    key: input.key,
    label: input.label,
    optionCount: 'options' in input ? input.options.length : 0,
  })),
  timeoutSec: def.timeoutSec,
  requireConfirm: def.requireConfirm,
  requireFreshSession: def.requireFreshSession,
  singleton: def.singleton,
  setting,
  fileName: file.fileName,
  revision: file.revision,
  editable: file.editable,
  // targetId は YAML に書かせない項目なので、編集画面へ戻す形からも外す
  source: file.editable ? toSource(def) : null,
})

/** カタログが注入した `targetId` を落として、定義ファイルに書ける形へ戻す */
const toSource = ({ targetId: _targetId, ...rest }: CommandDef): CommandDefEntry => rest

export type CommandDefsView = Awaited<ReturnType<typeof buildView>>

const buildView = async (opts?: { force?: boolean }) => {
  const result = getCommandCatalog(opts)
  // グループ一覧はコマンドをまたいで共通なので、取得はこの 1 箇所にまとめる
  const groups = await prisma.group.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
  const groupOptions = Object.fromEntries(groups.map((group) => [group.id, group.name])) as Record<string, string>

  const settings = await getCommandSettings(result.catalog.commands.map((def) => def.id))
  // コマンドから「どのファイルに書かれているか」を引けるようにする。編集の宛先になる
  const fileOf = new Map(
    result.catalog.files.map((file) => [
      file.target.id,
      { fileName: file.fileName, revision: file.revision, editable: file.target.editable, label: file.target.label },
    ]),
  )
  const commands = result.catalog.commands
    .map((def) => {
      const setting = settings.get(def.id) ?? defaultCommandSetting(def.id)
      const file = fileOf.get(def.targetId)
      // 並びの決め方は利用者向け画面と同じ関数に寄せる(食い違うと設定の効き方が読めなくなる)
      return toDefView(def, file ?? { fileName: '', revision: '', editable: false, label: '' }, {
        ...setting,
        sortOrder: effectiveSortOrder(setting, def),
      })
    })
    .sort((a, b) => a.setting.sortOrder - b.setting.sortOrder || a.label.localeCompare(b.label))

  // 読み込めたファイルと読み込めなかったファイルを両方出す。壊れたファイルがあっても
  // 残りのコマンドは実行できるので、画面も「全滅」ではなく「この分が欠けている」を見せる
  return {
    enabled: envu.server.COMMAND_EXEC_ENABLED,
    dir: result.dir,
    // 読み取り専用でマウントされている構成では編集の導線を出さない。
    // 押してから失敗させるより、初めから「できない」ことが見えている方がよい
    writable: result.writable,
    loadedAt: result.loadedAt,
    groupOptions,
    issues: result.issues,
    targets: result.catalog.files.map<CommandTargetStatus>(buildCommandTargetStatus),
    commands,
  }
}

/**
 * コマンド定義と設定の一覧。
 *
 * 読み込めなかったファイルがあっても画面は開けるようにし、原因をそのまま表示する。
 * 除外されたファイルのコマンドは、直せるまで一覧にも出ず実行もできない。
 */
export const getCommandDefsAction = safeAuthAction
  .metadata({ actionName: 'getCommandDefs', role: 'admin' })
  .action(async () => buildView())

export type GetCommandDefsReturnType = Awaited<ReturnType<typeof getCommandDefsAction>>['data']

/**
 * 定義ファイルの再読み込み。
 *
 * 通常は stat の変化で自動追随するので、ここは「今すぐ反映したい」ときの近道。
 * 押したプロセスにだけ即時反映され、他プロセスは通常どおり次の stat で追いつく。
 */
export const reloadCommandDefsAction = safeAuthAction
  .metadata({ actionName: 'reloadCommandDefs', role: 'admin' })
  .action(async ({ ctx: { user } }) => {
    if (!consumeRateLimit(`command-reload:${user.id}`, RELOAD_RATE_LIMIT)) {
      throw errTooManyRequests()
    }
    return buildView({ force: true })
  })

/**
 * コマンドごとの設定を保存する。
 *
 * 定義ファイルに無いキーは受け付けない。行だけが増えても実行はできないが、
 * 綴り違いを黙って保存すると「有効にしたのに一覧へ出ない」の原因になる。
 */
export const updateCommandSettingAction = safeAuthAction
  .metadata({ actionName: 'updateCommandSetting', role: 'admin' })
  .inputSchema(scUpdateCommandSetting)
  .action(async ({ parsedInput }) => {
    const result = getCommandCatalog()
    if (!result.catalog.commands.some((def) => def.id === parsedInput.commandKey)) {
      throw errInvalidOperation()
    }
    await setCommandSetting(parsedInput)
    return parsedInput
  })

/**
 * 書き込み系アクションの戻り値。
 *
 * 検証エラーの明細は `errorType` に載せられないので、**明細付きのものだけ成功応答で返す**。
 * 状態の問題(競合・編集不可・読み取り専用)は `errorType` で分岐できるよう throw する。
 */
export type EditCommandDefResult = { ok: true; view: CommandDefsView } | { ok: false; messages: string[] }

/** 検証で落ちたものだけ画面向けの形へ詰め替え、それ以外はそのまま投げる */
const toEditResult = async (error: unknown): Promise<EditCommandDefResult> => {
  if (error instanceof CommandDefWriteError && error.messages.length > 0) {
    return { ok: false, messages: error.messages }
  }
  throw error
}

/**
 * コマンド定義の追加・更新。
 *
 * 書けるのは `target.editable: true` のファイルの `commands` だけで、接続先(`target`)は
 * どのファイルでも画面から触れない。接続先を増やせない = 画面から到達できる実行先が増えないので、
 * この経路で広がる範囲は「既に鍵が通っている実行先」に閉じる。
 *
 * 実行時の `requireFreshSession` と同じ理由で再認証を求める。実行は一度きりだが、
 * 定義の書き換えは以後ずっと効くので、要求する理由はむしろ強い。
 */
export const upsertCommandDefAction = safeAuthAction
  .metadata({ actionName: 'upsertCommandDef', role: 'admin' })
  .inputSchema(scUpsertCommandDef)
  .action(async ({ parsedInput: { fileName, revision, replaceId, command }, ctx: { user, session } }) => {
    if (!consumeRateLimit(`command-def-edit:${user.id}`, EDIT_RATE_LIMIT)) {
      throw errTooManyRequests()
    }
    assertFreshSession(session)

    try {
      await editCommandFileCommands({
        fileName,
        revision,
        apply: (current) => {
          if (!replaceId) {
            return [...current.commands, command]
          }
          if (!current.commands.some((entry) => entry.id === replaceId)) {
            // 画面が見ていた 1 件が既に消えている。上書きで復活させない
            throw new CommandDefWriteError(COMMAND_DEF_CONFLICT)
          }
          return current.commands.map((entry) => (entry.id === replaceId ? command : entry))
        },
      })

      // ID を変えた更新は履歴の上でも別のコマンドになるので、古い ID の設定は引き継がず捨てる。
      // 残すと、同じ ID を後から別の用途で作ったときに昔の許可がそのまま効く
      if (replaceId && replaceId !== command.id) {
        await deleteCommandSetting(replaceId)
      }

      // 実行履歴は残るのに定義の変更履歴がどこにも残らないのは非対称なので、監査ログを残す
      logger.warn(
        { userId: user.id, fileName, replaceId, commandId: command.id, executable: command.executable },
        'command def updated',
      )
      return { ok: true as const, view: await buildView({ force: true }) }
    } catch (error) {
      return toEditResult(error)
    }
  })

/** コマンド定義の削除。定義を消したら設定行も消す(理由は `deleteCommandSetting` を参照) */
export const deleteCommandDefAction = safeAuthAction
  .metadata({ actionName: 'deleteCommandDef', role: 'admin' })
  .inputSchema(scDeleteCommandDef)
  .action(async ({ parsedInput: { fileName, revision, commandId }, ctx: { user, session } }) => {
    if (!consumeRateLimit(`command-def-edit:${user.id}`, EDIT_RATE_LIMIT)) {
      throw errTooManyRequests()
    }
    assertFreshSession(session)

    try {
      await editCommandFileCommands({
        fileName,
        revision,
        apply: (current) => {
          if (!current.commands.some((entry) => entry.id === commandId)) {
            throw new CommandDefWriteError(COMMAND_DEF_CONFLICT)
          }
          return current.commands.filter((entry) => entry.id !== commandId)
        },
      })

      // ファイルが書けてから設定を消す。逆順にすると、書き込みに失敗したときに
      // 「定義は生きているのに許可だけ消えた」状態が残る
      await deleteCommandSetting(commandId)
      logger.warn({ userId: user.id, fileName, commandId }, 'command def deleted')
      return { ok: true as const, view: await buildView({ force: true }) }
    } catch (error) {
      return toEditResult(error)
    }
  })
