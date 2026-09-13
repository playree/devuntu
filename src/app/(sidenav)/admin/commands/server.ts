'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { type CommandDef } from '@/lib/command/command'
import { buildCommandHostStatus, type CommandHostStatus, getCommandCatalog } from '@/lib/command/command-catalog'
import { envu } from '@/lib/env-util'
import { errTooManyRequests } from '@/lib/error'
import { consumeRateLimit } from '@/lib/rate-limit'

/** 定義の再読み込みは I/O を伴うので、連打で叩き続けられないようにする */
const RELOAD_RATE_LIMIT = { limit: 10, windowMs: 60_000 }

/**
 * 画面へ出す 1 コマンドぶんの情報。
 *
 * 接続先(ホスト名・ユーザー・鍵のパス)は秘密として扱い、ホストの表示名だけを載せる。
 */
export type CommandDefView = {
  id: string
  label: string
  description: string | null
  hostId: string
  hostLabel: string | null
  executable: string
  args: string[]
  inputs: { type: CommandDef['inputs'][number]['type']; key: string; label: string; optionCount: number }[]
  timeoutSec: number
  requireConfirm: boolean
  requireFreshSession: boolean
  singleton: boolean
  sortOrder: number
}

const toDefView = (def: CommandDef, hostLabels: Map<string, string>): CommandDefView => ({
  id: def.id,
  label: def.label,
  description: def.description ?? null,
  hostId: def.hostId,
  hostLabel: hostLabels.get(def.hostId) ?? null,
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
})

const buildView = (opts?: { force?: boolean }) => {
  const result = getCommandCatalog(opts)
  const base = {
    enabled: envu.server.COMMAND_EXEC_ENABLED,
    path: result.path,
    loadedAt: result.loadedAt,
  }
  if (!result.ok) {
    return { ...base, ok: false as const, issues: result.issues, hosts: [], commands: [] }
  }
  const hostLabels = new Map(result.catalog.hosts.map((host) => [host.id, host.label]))
  return {
    ...base,
    ok: true as const,
    issues: [] as string[],
    hosts: result.catalog.hosts.map<CommandHostStatus>(buildCommandHostStatus),
    commands: result.catalog.commands.map((def) => toDefView(def, hostLabels)),
  }
}

/**
 * コマンド定義の一覧(読み取り専用)。
 *
 * 定義ファイルが壊れていても画面は開けるようにし、原因をそのまま表示する。
 * 直前の正常な定義は保持しないので、ここでエラーが出ている間はコマンドを実行できない。
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
