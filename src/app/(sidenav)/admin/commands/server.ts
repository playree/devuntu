'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { type CommandDef } from '@/lib/command/command'
import { effectiveSortOrder } from '@/lib/command/command-access'
import { buildCommandHostStatus, type CommandHostStatus, getCommandCatalog } from '@/lib/command/command-catalog'
import { defaultCommandSetting, getCommandSettings, setCommandSetting } from '@/lib/command/command-settings'
import { envu } from '@/lib/env-util'
import { errInvalidOperation, errTooManyRequests } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit } from '@/lib/rate-limit'
import { scUpdateCommandSetting } from '@/lib/schema/schema'

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
  /** 画面で編集する設定。定義ファイル側の sortOrder はここで上書きされる */
  setting: { enabled: boolean; sortOrder: number; allowedGroupIds: string[] }
}

const toDefView = (
  def: CommandDef,
  hostLabels: Map<string, string>,
  setting: { enabled: boolean; sortOrder: number; allowedGroupIds: string[] },
): CommandDefView => ({
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
  setting,
})

const buildView = async (opts?: { force?: boolean }) => {
  const result = getCommandCatalog(opts)
  // グループ一覧はコマンドをまたいで共通なので、取得はこの 1 箇所にまとめる
  const groups = await prisma.group.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
  const groupOptions = Object.fromEntries(groups.map((group) => [group.id, group.name])) as Record<string, string>

  const settings = await getCommandSettings(result.catalog.commands.map((def) => def.id))
  const hostLabels = new Map(result.catalog.hosts.map((host) => [host.id, host.label]))
  const commands = result.catalog.commands
    .map((def) => {
      const setting = settings.get(def.id) ?? defaultCommandSetting(def.id)
      // 並びの決め方は利用者向け画面と同じ関数に寄せる(食い違うと設定の効き方が読めなくなる)
      return toDefView(def, hostLabels, { ...setting, sortOrder: effectiveSortOrder(setting, def) })
    })
    .sort((a, b) => a.setting.sortOrder - b.setting.sortOrder || a.label.localeCompare(b.label))

  // 読み込めたファイルと読み込めなかったファイルを両方出す。壊れたファイルがあっても
  // 残りのコマンドは実行できるので、画面も「全滅」ではなく「この分が欠けている」を見せる
  return {
    enabled: envu.server.COMMAND_EXEC_ENABLED,
    dir: result.dir,
    loadedAt: result.loadedAt,
    groupOptions,
    issues: result.issues,
    hosts: result.catalog.files.map<CommandHostStatus>(buildCommandHostStatus),
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
