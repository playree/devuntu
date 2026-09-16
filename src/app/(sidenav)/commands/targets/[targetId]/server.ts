'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { assertFreshSession } from '@/lib/auth/session-fresh'
import { COMMAND_DEF_CONFLICT, type CommandDef, type CommandTargetRole } from '@/lib/command/command'
import { assertCommandTargetAccess } from '@/lib/command/command-access'
import { getCommandTargetUsers } from '@/lib/command/command-assign'
import { buildCommandTargetStatus, type CommandTargetStatus, getCommandCatalog } from '@/lib/command/command-catalog'
import { scDeleteCommandDef, scUpsertCommandDef } from '@/lib/command/command-def'
import { type CommandDefEntry, CommandDefWriteError, editCommandFileCommands } from '@/lib/command/command-writer'
import { errInvalidOperation, errTooManyRequests } from '@/lib/error'
import { logger } from '@/lib/logger'
import { consumeRateLimit } from '@/lib/rate-limit'
import { scCommandTargetKey } from '@/lib/schema/schema'

/** 定義ファイルの書き換えは I/O とディレクトリの全走査を伴うので、連打で叩けないようにする */
const EDIT_RATE_LIMIT = { limit: 20, windowMs: 60_000 }

/**
 * 画面へ出す 1 コマンドぶんの情報。
 *
 * 接続先(ホスト名・ユーザー・鍵のパス)は秘密として扱い、ターゲットの表示名だけを載せる。
 */
export type CommandDefView = {
  id: string
  label: string
  description: string | null
  executable: string
  args: string[]
  inputs: { type: CommandDef['inputs'][number]['type']; key: string; label: string; optionCount: number }[]
  timeoutSec: number
  requireConfirm: boolean
  requireFreshSession: boolean
  singleton: boolean
  sortOrder: number
  /**
   * 編集画面へ渡す定義の現物。編集できないファイルでは null。
   *
   * 秘密(接続先・鍵)は `target` 側にあり、ここには入らない。
   */
  source: CommandDefEntry | null
}

/** カタログが注入した `targetId` を落として、定義ファイルに書ける形へ戻す */
const toSource = ({ targetId: _targetId, ...rest }: CommandDef): CommandDefEntry => rest

const toDefView = (def: CommandDef, editable: boolean): CommandDefView => ({
  id: def.id,
  label: def.label,
  description: def.description ?? null,
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
  sortOrder: def.sortOrder,
  source: editable ? toSource(def) : null,
})

export type CommandTargetDetail = {
  target: CommandTargetStatus
  role: CommandTargetRole
  via: 'member' | 'group'
  /** 定義ディレクトリへ書けるか。書けない構成では編集の導線を出さない */
  writable: boolean
  /** オーナーで、かつファイルが editable で、ディレクトリが書き込み可 */
  canEditDef: boolean
  commands: CommandDefView[]
}

/**
 * ターゲット1件の詳細。メンバーなら閲覧でき、定義の編集はオーナーだけができる。
 *
 * 認可は `assertCommandTargetAccess` に集約する(`src/proxy.ts` は Server Action を通らないため、
 * パス単位の制御ではこの画面を守れない)。
 */
export const getCommandTargetDetailAction = safeAuthAction
  .metadata({ actionName: 'getCommandTargetDetail', role: 'user' })
  .inputSchema(scCommandTargetKey)
  .action(async ({ parsedInput: { targetKey }, ctx: { user } }): Promise<CommandTargetDetail> => {
    const { access } = await assertCommandTargetAccess(user, targetKey, 'execute')

    const result = getCommandCatalog()
    const file = result.catalog.files.find((entry) => entry.target.id === targetKey)
    if (!file) {
      throw errInvalidOperation()
    }

    const canEditDef = access.role === 'owner' && file.target.editable && result.writable
    return {
      target: buildCommandTargetStatus(file),
      role: access.role,
      via: access.via,
      writable: result.writable,
      canEditDef,
      // 編集できない相手には定義の現物を返さない
      commands: file.commands.map((def) => toDefView(def, canEditDef)),
    }
  })

export type GetCommandTargetDetailReturnType = Awaited<ReturnType<typeof getCommandTargetDetailAction>>['data']

/** ターゲットのメンバー一覧。アサインの変更は管理者だけなので、ここは読み取りのみ */
export const getCommandTargetMembersAction = safeAuthAction
  .metadata({ actionName: 'getCommandTargetMembers', role: 'user' })
  .inputSchema(scCommandTargetKey)
  .action(async ({ parsedInput: { targetKey }, ctx: { user } }) => {
    await assertCommandTargetAccess(user, targetKey, 'execute')
    return getCommandTargetUsers(targetKey)
  })

export type GetCommandTargetMembersReturnType = Awaited<ReturnType<typeof getCommandTargetMembersAction>>['data']

/**
 * 書き込み系アクションの戻り値。
 *
 * 検証エラーの明細は `errorType` に載せられないので、**明細付きのものだけ成功応答で返す**。
 * 状態の問題(競合・編集不可・読み取り専用)は `errorType` で分岐できるよう throw する。
 */
export type EditCommandDefResult = { ok: true } | { ok: false; messages: string[] }

/** 検証で落ちたものだけ画面向けの形へ詰め替え、それ以外はそのまま投げる */
const toEditResult = async (error: unknown): Promise<EditCommandDefResult> => {
  if (error instanceof CommandDefWriteError && error.messages.length > 0) {
    return { ok: false, messages: error.messages }
  }
  throw error
}

/**
 * 編集の前段。オーナーであることを確かめ、書き込む先のファイル名をカタログから引く。
 *
 * 画面からはターゲットIDしか受け取らない。ファイル名を受け取る形にすると、
 * 権限のあるターゲットの名で別のファイルを指せてしまう。
 * 引いたファイル名が本当にこのターゲットのものかは、書き込み側がロック内で再確認する。
 */
const resolveEditTarget = async (
  user: { id: string; role?: string | null },
  session: { createdAt: Date },
  targetKey: string,
): Promise<string> => {
  if (!consumeRateLimit(`command-def-edit:${user.id}`, EDIT_RATE_LIMIT)) {
    throw errTooManyRequests()
  }
  await assertCommandTargetAccess(user, targetKey, 'edit')
  // 実行時の requireFreshSession と同じ理由で再認証を求める。実行は一度きりだが、
  // 定義の書き換えは以後ずっと効くので、要求する理由はむしろ強い
  assertFreshSession(session)

  const file = getCommandCatalog().catalog.files.find((entry) => entry.target.id === targetKey)
  if (!file) {
    throw errInvalidOperation()
  }
  return file.fileName
}

/**
 * コマンド定義の追加・更新。
 *
 * 書けるのは `target.editable: true` のファイルの `commands` だけで、接続先(`target`)は
 * どのファイルでも画面から触れない。接続先を増やせない = 画面から到達できるターゲットが増えないので、
 * この経路で広がる範囲は「既に鍵が通っているターゲット」に閉じる。
 */
export const upsertCommandDefAction = safeAuthAction
  .metadata({ actionName: 'upsertCommandDef', role: 'user' })
  .inputSchema(scUpsertCommandDef)
  .action(async ({ parsedInput: { targetKey, revision, replaceId, command }, ctx: { user, session } }) => {
    const fileName = await resolveEditTarget(user, session, targetKey)

    try {
      await editCommandFileCommands({
        fileName,
        targetId: targetKey,
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

      // 実行履歴は残るのに定義の変更履歴がどこにも残らないのは非対称なので、監査ログを残す
      logger.warn(
        { userId: user.id, targetKey, fileName, replaceId, commandId: command.id, executable: command.executable },
        'command def updated',
      )
      // view は返さない。ここで組み立てに失敗すると、書けているのに失敗として返ってしまう
      // (画面は成功後に自分で取り直す)
      return { ok: true as const }
    } catch (error) {
      return toEditResult(error)
    }
  })

/** コマンド定義の削除 */
export const deleteCommandDefAction = safeAuthAction
  .metadata({ actionName: 'deleteCommandDef', role: 'user' })
  .inputSchema(scDeleteCommandDef)
  .action(async ({ parsedInput: { targetKey, revision, commandId }, ctx: { user, session } }) => {
    const fileName = await resolveEditTarget(user, session, targetKey)

    try {
      await editCommandFileCommands({
        fileName,
        targetId: targetKey,
        revision,
        apply: (current) => {
          if (!current.commands.some((entry) => entry.id === commandId)) {
            throw new CommandDefWriteError(COMMAND_DEF_CONFLICT)
          }
          return current.commands.filter((entry) => entry.id !== commandId)
        },
      })

      logger.warn({ userId: user.id, targetKey, fileName, commandId }, 'command def deleted')
      return { ok: true as const }
    } catch (error) {
      return toEditResult(error)
    }
  })
