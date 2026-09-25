/**
 * リモート実行の認可判定(サーバー専用)
 *
 * `src/proxy.ts` の matcher は Server Action(next-action ヘッダ)と `/api/**` を除外しているため、
 * パス単位の制御ではこの機能を守れない。実行にも一覧にも定義の編集にも、必ずここを通す。
 *
 * 判定は `assertBoardAccess`(`src/lib/board/board-access.ts`)と同じ形にしてある。違いは 2 点:
 * - **管理者特権が無い。** アサインされていないターゲットは管理者でも実行も編集もできない
 *   (管理者の特権はアサインの操作だけで、それは Server Action 側が `isAdminActor` で見る)
 * - ターゲットの実体は YAML にあり DB に親行が無いので、1 クエリでは解決できない
 *
 * **DB を引くキーは必ず読み込み済みカタログ由来にする。** 定義から消えたターゲットのアサイン行が
 * 残っていても、この経路に載らない限り権限を持てない(fail closed)。
 */

import { type Actor } from '../board/board-access'
import { envu } from '../env-util'
import { errInvalidOperation } from '../error'
import { prisma } from '../prisma'
import {
  type CommandDef,
  type CommandTarget,
  type CommandTargetRole,
  compareCommandDefs,
  resolveCommandTargetRole,
} from './command'
import {
  buildCommandTargetStatus,
  type CommandTargetStatus,
  findCommandDef,
  getCommandCatalog,
} from './command-catalog'

/** `execute` は実行と閲覧、`edit` は定義の編集。編集はオーナーだけができる */
export type CommandNeed = 'execute' | 'edit'

export type CommandTargetAccess = {
  targetKey: string
  role: CommandTargetRole
  /** 直接メンバーか、グループ経由か */
  via: 'member' | 'group'
}

/**
 * 渡したキーのうち、そのユーザーがアサインされているものを解決する。
 *
 * 呼び出し側はカタログに載っているキーだけを渡すこと。ここで絞らないと、
 * 定義から消えたターゲットのアサイン行が権限を持ってしまう。
 */
const resolveAccessMap = async (actor: Actor, targetKeys: string[]): Promise<Map<string, CommandTargetAccess>> => {
  const access = new Map<string, CommandTargetAccess>()
  if (targetKeys.length === 0) {
    return access
  }

  const [members, groups] = await Promise.all([
    prisma.commandTargetMember.findMany({
      where: { userId: actor.id, targetKey: { in: targetKeys } },
      select: { targetKey: true, role: true },
    }),
    prisma.commandTargetGroup.findMany({
      where: { targetKey: { in: targetKeys }, group: { userGroups: { some: { userId: actor.id } } } },
      select: { targetKey: true },
    }),
  ])

  const directRoles = new Map(members.map((member) => [member.targetKey, member.role]))
  const groupKeys = new Set(groups.map((group) => group.targetKey))

  for (const targetKey of targetKeys) {
    const directRole = directRoles.get(targetKey) ?? null
    const role = resolveCommandTargetRole(directRole, groupKeys.has(targetKey))
    if (role) {
      access.set(targetKey, { targetKey, role, via: directRole ? 'member' : 'group' })
    }
  }
  return access
}

/** 機能そのものが有効か。無効なら定義があっても誰も何もできない */
const assertEnabled = (): void => {
  if (!envu.server.COMMAND_EXEC_ENABLED) {
    throw errInvalidOperation()
  }
}

/** `need` を満たすロールか。編集はオーナーだけ */
const satisfies = (role: CommandTargetRole, need: CommandNeed): boolean => need !== 'edit' || role === 'owner'

/** 1件ぶんの判定。カタログに無いターゲットは常に null */
export const getCommandTargetAccess = async (actor: Actor, targetKey: string): Promise<CommandTargetAccess | null> => {
  const exists = getCommandCatalog().catalog.targets.some((target) => target.id === targetKey)
  if (!exists) {
    return null
  }
  return (await resolveAccessMap(actor, [targetKey])).get(targetKey) ?? null
}

/**
 * ターゲットを扱えることを確かめる。扱えなければ throw する。
 *
 * 存在しないターゲットと権限が無いターゲットを同じ `errInvalidOperation` にしているのは、
 * どのターゲットが定義されているかを、アクセスできない相手に教えないため。
 *
 * **`target.editable` と定義ディレクトリの書き込み可否はここでは見ない。** 書き込みの可否は
 * `command-writer.ts` がロック内で確かめて専用のエラーコードを返し、画面がそれで文言を出し分ける。
 * ここで潰すと「なぜ編集できないか」が利用者に伝わらなくなる。
 */
export const assertCommandTargetAccess = async (
  actor: Actor,
  targetKey: string,
  need: CommandNeed,
): Promise<{ target: CommandTarget; access: CommandTargetAccess }> => {
  assertEnabled()

  const target = getCommandCatalog().catalog.targets.find((entry) => entry.id === targetKey)
  if (!target) {
    throw errInvalidOperation()
  }

  const access = (await resolveAccessMap(actor, [targetKey])).get(targetKey)
  if (!access || !satisfies(access.role, need)) {
    throw errInvalidOperation()
  }
  return { target, access }
}

/** 指定コマンドを扱えることを確かめる。コマンドの権限は、それが属するターゲットの権限そのもの */
export const assertCommandAccess = async (
  actor: Actor,
  commandKey: string,
  need: CommandNeed,
): Promise<{ def: CommandDef; target: CommandTarget; access: CommandTargetAccess }> => {
  assertEnabled()

  const def = findCommandDef(commandKey)
  if (!def) {
    throw errInvalidOperation()
  }

  const { target, access } = await assertCommandTargetAccess(actor, def.targetId, need)
  return { def, target, access }
}

/** 利用者がアサインされているターゲットの一覧。ラベル順 */
export const listCommandTargetsForActor = async (
  actor: Actor,
): Promise<{ status: CommandTargetStatus; access: CommandTargetAccess }[]> => {
  if (!envu.server.COMMAND_EXEC_ENABLED) {
    return []
  }

  const files = getCommandCatalog().catalog.files
  const access = await resolveAccessMap(
    actor,
    files.map((file) => file.target.id),
  )

  return files
    .flatMap((file) => {
      const entry = access.get(file.target.id)
      return entry ? [{ status: buildCommandTargetStatus(file), access: entry }] : []
    })
    .sort((a, b) => a.status.label.localeCompare(b.status.label))
}

/**
 * 実行できるコマンドの一覧。
 *
 * 一覧に出るのに実行すると弾かれる、という食い違いを作らないため、
 * 判定はこの関数と `assertCommandAccess` で同じものを使う。
 */
export const listAvailableCommands = async (
  actor: Actor,
): Promise<{ def: CommandDef; targetLabel: string; access: CommandTargetAccess }[]> => {
  if (!envu.server.COMMAND_EXEC_ENABLED) {
    return []
  }

  const { catalog } = getCommandCatalog()
  if (catalog.commands.length === 0) {
    return []
  }

  const access = await resolveAccessMap(
    actor,
    catalog.targets.map((target) => target.id),
  )
  const labels = new Map(catalog.targets.map((target) => [target.id, target.label]))

  return catalog.commands
    .flatMap((def) => {
      const entry = access.get(def.targetId)
      return entry ? [{ def, targetLabel: labels.get(def.targetId) ?? '', access: entry }] : []
    })
    .sort((a, b) => compareCommandDefs(a.def, b.def))
}

/**
 * メニューの出し分け用。1つでも行き先があるか。
 *
 * 「アサインされたターゲットがあるか」だけでは足りない。コマンドが 0 件のターゲットに
 * member をアサインすると、実行するものも設定への導線も無い画面へ送ることになる。
 * オーナーは空のターゲットでも定義を作りに行く必要があるので、そちらは出す。
 */
export const canUseAnyCommand = async (actor: Actor): Promise<boolean> => {
  const targets = await listCommandTargetsForActor(actor)
  if (targets.length === 0) {
    // 機能が無効なときもここに入る。カタログを読みに行かせない
    return false
  }

  const commandTargetKeys = new Set(getCommandCatalog().catalog.commands.map((command) => command.targetId))
  return targets.some(({ status, access }) => access.role === 'owner' || commandTargetKeys.has(status.id))
}
