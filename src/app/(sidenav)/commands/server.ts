'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { assertFreshSession } from '@/lib/auth/session-fresh'
import { isAdminActor } from '@/lib/board/board'
import { type CommandDef, type CommandInput } from '@/lib/command/command'
import { assertCommandAccess, listAvailableCommands } from '@/lib/command/command-access'
import { buildArgsPreview, buildCommandInputDefaults, resolveCommandArgs } from '@/lib/command/command-args'
import { findCommandTarget, getCommandCatalog } from '@/lib/command/command-catalog'
import { enqueueCommandRun, getCommandRun, listCommandRuns, requestCancelCommandRun } from '@/lib/command/command-run'
import { kickCommandDispatch } from '@/lib/command/command-worker'
import { envu } from '@/lib/env-util'
import { errInvalidOperation, errNotFound, errTooManyRequests } from '@/lib/error'
import { consumeRateLimit } from '@/lib/rate-limit'
import { scCommandRunListQuery, scStartCommandRun, scUUID } from '@/lib/schema/schema'

/** 起動の連打を抑える。1人が短時間に大量のジョブを積めないようにする */
const START_RATE_LIMIT = { limit: 10, windowMs: 60_000 }

/**
 * 利用者へ出す 1 コマンドぶんの情報。
 *
 * 接続先(ホスト名・ユーザー・鍵のパス)は秘密として扱い、ホストの表示名だけを載せる。
 */
export type AvailableCommandView = {
  id: string
  label: string
  description: string | null
  targetLabel: string | null
  inputs: CommandInput[]
  defaults: Record<string, string | string[] | boolean>
  requireConfirm: boolean
  confirmText: string | null
  requireFreshSession: boolean
  timeoutSec: number
}

const toView = (def: CommandDef, targetLabel: string | null): AvailableCommandView => ({
  id: def.id,
  label: def.label,
  description: def.description ?? null,
  targetLabel,
  // 入力項目は画面のフォームを組み立てるのに要る。選択肢は元々利用者へ見せる値なので秘密ではない
  inputs: def.inputs,
  defaults: buildCommandInputDefaults(def),
  requireConfirm: def.requireConfirm,
  confirmText: def.confirmText ?? null,
  requireFreshSession: def.requireFreshSession,
  timeoutSec: def.timeoutSec,
})

/**
 * 実行できるコマンドの一覧。
 *
 * 認可は `listAvailableCommands` に集約する(`src/proxy.ts` は Server Action を通らないため、
 * パス単位の制御ではこの機能を守れない)。
 */
export const getAvailableCommandsAction = safeAuthAction
  .metadata({ actionName: 'getAvailableCommands', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    // 一覧に出るのに実行すると弾かれる状態を作らないよう、実行できるものだけを返す
    const available = await listAvailableCommands(user, 'execute')
    const targetLabels = new Map(getCommandCatalog().catalog.targets.map((target) => [target.id, target.label]))

    return available.map(({ def }) => toView(def, targetLabels.get(def.targetId) ?? null))
  })

export type GetAvailableCommandsReturnType = Awaited<ReturnType<typeof getAvailableCommandsAction>>['data']

/**
 * 実行を待ち行列へ積み、runId を即座に返す。
 *
 * 実行そのものをここで完走させないのは、レスポンスの寿命と実行の寿命を一致させられないため
 * (`after()` に入れると長時間のジョブが graceful shutdown をブロックする)。
 */
export const startCommandRunAction = safeAuthAction
  .metadata({ actionName: 'startCommandRun', role: 'user' })
  .inputSchema(scStartCommandRun)
  .action(async ({ parsedInput: { commandKey, params }, ctx: { user, session } }) => {
    if (!consumeRateLimit(`command-start:${user.id}`, START_RATE_LIMIT)) {
      throw errTooManyRequests()
    }

    const { def } = await assertCommandAccess(user, commandKey, 'execute')

    // 破壊的なコマンドだけが opt-in する。常時強制すると日常運用のたびに再ログインを迫ることになる
    if (def.requireFreshSession) {
      assertFreshSession(session)
    }

    const host = findCommandTarget(def.targetId)
    if (!host) {
      throw errInvalidOperation()
    }

    // 画面を通さない呼び出しに備えて、選択肢の中にあることをここでも確かめる
    const args = resolveCommandArgs(def, params)

    const run = await enqueueCommandRun({
      def,
      targetLabel: host.label,
      actor: { id: user.id, name: user.name },
      params,
      argsPreview: buildArgsPreview(def, args),
      maxQueued: envu.server.COMMAND_MAX_QUEUED,
    })

    // レスポンス後にすぐ1周させ、tick 間隔ぶん待たせない
    kickCommandDispatch()
    return run
  })

/**
 * 実行の状態。SSE が使えない場合の取得経路も兼ねる。
 *
 * 実行者本人と管理者だけが見られる。存在を漏らさないため、権限が無い場合も 404 相当にする。
 */
export const getCommandRunAction = safeAuthAction
  .metadata({ actionName: 'getCommandRun', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id }, ctx: { user } }) => {
    const run = await getCommandRun(id)
    if (!run || (run.userId !== user.id && !isAdminActor(user))) {
      throw errNotFound()
    }
    return run
  })

export type GetCommandRunReturnType = Awaited<ReturnType<typeof getCommandRunAction>>['data']

/**
 * 実行の中断を要求する。
 *
 * `queued` はその場で確定する。`running` はフラグを立てるだけで、実際に止めるのは
 * 実行を掴んでいるワーカー(別プロセスの子プロセスは kill できないため)。
 */
export const cancelCommandRunAction = safeAuthAction
  .metadata({ actionName: 'cancelCommandRun', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id }, ctx: { user } }) => {
    const run = await getCommandRun(id)
    if (!run || (run.userId !== user.id && !isAdminActor(user))) {
      throw errNotFound()
    }
    const status = await requestCancelCommandRun(id, user.id)
    kickCommandDispatch()
    return { status }
  })

/**
 * 実行履歴の一覧。
 *
 * 一般ユーザーは自分の実行だけ。管理者が `scope: 'all'` を渡したときだけ全件を返す。
 * 一覧に出すのは表示名と結果だけで、選択された値(`params`)は詳細でしか見せない。
 */
export const getCommandRunsAction = safeAuthAction
  .metadata({ actionName: 'getCommandRuns', role: 'user' })
  .inputSchema(scCommandRunListQuery)
  .action(async ({ parsedInput: { scope, status, page, rowsPerPage, sortColumn, sortDirection }, ctx: { user } }) => {
    // 一般ユーザーが scope を偽っても、ここで自分の分に絞る
    const userId = scope === 'all' && isAdminActor(user) ? null : user.id
    return listCommandRuns({ userId, status, page, rowsPerPage, sortColumn, sortDirection })
  })

export type GetCommandRunsReturnType = Awaited<ReturnType<typeof getCommandRunsAction>>['data']
