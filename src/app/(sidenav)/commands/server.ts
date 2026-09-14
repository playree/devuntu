'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { listAvailableCommands } from '@/lib/command/command-access'
import { getCommandCatalog } from '@/lib/command/command-catalog'

/**
 * 利用者へ出す 1 コマンドぶんの情報。
 *
 * 接続先(ホスト名・ユーザー・鍵のパス)は秘密として扱い、ホストの表示名だけを載せる。
 * 引数テンプレートも実行前は見せず、実行フォーム(Phase 3)で選択に応じたプレビューを出す。
 */
export type AvailableCommandView = {
  id: string
  label: string
  description: string | null
  hostLabel: string | null
  inputCount: number
  requireConfirm: boolean
  requireFreshSession: boolean
}

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
    const result = getCommandCatalog()
    const hostLabels = new Map(result.ok ? result.catalog.hosts.map((host) => [host.id, host.label]) : [])

    return available.map<AvailableCommandView>(({ def }) => ({
      id: def.id,
      label: def.label,
      description: def.description ?? null,
      hostLabel: hostLabels.get(def.hostId) ?? null,
      inputCount: def.inputs.length,
      requireConfirm: def.requireConfirm,
      requireFreshSession: def.requireFreshSession,
    }))
  })

export type GetAvailableCommandsReturnType = Awaited<ReturnType<typeof getAvailableCommandsAction>>['data']
