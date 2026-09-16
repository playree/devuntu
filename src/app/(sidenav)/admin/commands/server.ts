'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { isAdminActor } from '@/lib/board/board'
import {
  assertCommandAssignmentTargets,
  countCommandTargetAssignments,
  deleteCommandTargetAssignments,
  getCommandTargetAssignments,
  getCommandTargetUsers,
  listAssignedTargetKeys,
  removeCommandTargetMember,
  syncCommandTargetGroups,
  upsertCommandTargetMember,
} from '@/lib/command/command-assign'
import {
  buildCommandTargetStatus,
  type CommandCatalogFile,
  type CommandTargetStatus,
  getCommandCatalog,
} from '@/lib/command/command-catalog'
import { envu } from '@/lib/env-util'
import { errInvalidOperation, errTooManyRequests } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit } from '@/lib/rate-limit'
import {
  scCommandTargetKey,
  scRemoveCommandTargetMember,
  scSetCommandTargetGroups,
  scUpsertCommandTargetMember,
} from '@/lib/schema/schema'

/** 定義の再読み込みは I/O を伴うので、連打で叩き続けられないようにする */
const RELOAD_RATE_LIMIT = { limit: 10, windowMs: 60_000 }

/** 一覧に出すターゲット1件ぶん。アサインの件数を添えて、割り当て漏れに気付けるようにする */
export type CommandTargetView = CommandTargetStatus & {
  memberCount: number
  groupCount: number
}

/**
 * アサイン操作の共通前処理。
 *
 * `role: 'admin'` のメタデータだけでは足りない。定義に無いターゲットへ行を作られると、
 * どの画面にも出ないアサインが増えてしまうので、カタログに載っていることもここで確かめる。
 */
const assertManageableTarget = (actor: { id: string; role?: string | null }, targetKey: string): CommandCatalogFile => {
  if (!isAdminActor(actor)) {
    throw errInvalidOperation()
  }
  const file = getCommandCatalog().catalog.files.find((entry) => entry.target.id === targetKey)
  if (!file) {
    throw errInvalidOperation()
  }
  return file
}

const buildView = async (opts?: { force?: boolean }) => {
  const result = getCommandCatalog(opts)
  const targetKeys = result.catalog.files.map((file) => file.target.id)

  const [counts, assignedKeys] = await Promise.all([
    countCommandTargetAssignments(targetKeys),
    listAssignedTargetKeys(),
  ])

  const targets = result.catalog.files.map<CommandTargetView>((file) => {
    const count = counts.get(file.target.id) ?? { members: 0, groups: 0 }
    return { ...buildCommandTargetStatus(file), memberCount: count.members, groupCount: count.groups }
  })

  /**
   * 定義ディレクトリを読めていない状態かどうか。
   *
   * ディレクトリ自体の問題(`fileName` が null)や、アサインはあるのにファイルが 1 件も
   * 読めていない状態では、孤児の判定ができない。マウント漏れの一時障害を「消してよい行」と
   * 見せると、復旧後に全部やり直すことになる。
   */
  const degraded =
    result.issues.some((issue) => issue.fileName === null) ||
    (result.catalog.files.length === 0 && assignedKeys.length > 0)

  const known = new Set(targetKeys)
  const orphans = degraded ? [] : assignedKeys.filter((key) => !known.has(key))

  // 読み込めたファイルと読み込めなかったファイルを両方出す。壊れたファイルがあっても
  // 残りのコマンドは実行できるので、画面も「全滅」ではなく「この分が欠けている」を見せる
  return {
    enabled: envu.server.COMMAND_EXEC_ENABLED,
    dir: result.dir,
    // 読み取り専用でマウントされている構成では編集の導線を出さない
    writable: result.writable,
    loadedAt: result.loadedAt,
    issues: result.issues,
    targets,
    orphans: await Promise.all(
      orphans.map(async (targetKey) => {
        const count = (await countCommandTargetAssignments([targetKey])).get(targetKey)
        return { targetKey, memberCount: count?.members ?? 0, groupCount: count?.groups ?? 0 }
      }),
    ),
    orphanUnknown: degraded,
  }
}

/**
 * ターゲットの一覧。
 *
 * 読み込めなかったファイルがあっても画面は開けるようにし、原因をそのまま表示する。
 * 除外されたファイルのコマンドは、直せるまで一覧にも出ず実行もできない。
 */
export const getCommandTargetsAction = safeAuthAction
  .metadata({ actionName: 'getCommandTargets', role: 'admin' })
  .action(async () => buildView())

export type GetCommandTargetsReturnType = Awaited<ReturnType<typeof getCommandTargetsAction>>['data']

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

/** アサイン編集フォームの初期値と選択肢 */
export const getCommandTargetAssignmentsAction = safeAuthAction
  .metadata({ actionName: 'getCommandTargetAssignments', role: 'admin' })
  .inputSchema(scCommandTargetKey)
  .action(async ({ parsedInput: { targetKey }, ctx: { user } }) => {
    const file = assertManageableTarget(user, targetKey)
    return { ...(await getCommandTargetAssignments(targetKey)), targetLabel: file.target.label }
  })

export type GetCommandTargetAssignmentsReturnType = Awaited<
  ReturnType<typeof getCommandTargetAssignmentsAction>
>['data']

/** ターゲットのメンバー一覧(直接 ∪ グループ経由) */
export const getCommandTargetMembersAction = safeAuthAction
  .metadata({ actionName: 'getCommandTargetMembersForAdmin', role: 'admin' })
  .inputSchema(scCommandTargetKey)
  .action(async ({ parsedInput: { targetKey }, ctx: { user } }) => {
    assertManageableTarget(user, targetKey)
    return getCommandTargetUsers(targetKey)
  })

export type GetCommandTargetMembersReturnType = Awaited<ReturnType<typeof getCommandTargetMembersAction>>['data']

/** 直接メンバーの追加。追加と更新で処理が同じなので実体は `upsertCommandTargetMember` を共有する */
export const addCommandTargetMemberAction = safeAuthAction
  .metadata({ actionName: 'addCommandTargetMember', role: 'admin' })
  .inputSchema(scUpsertCommandTargetMember)
  .action(async ({ parsedInput: { targetKey, userId, role }, ctx: { user } }) => {
    assertManageableTarget(user, targetKey)
    await prisma.$transaction(async (tx) => {
      await assertCommandAssignmentTargets(tx, { userIds: [userId], groupIds: [] })
      await upsertCommandTargetMember(tx, { targetKey, userId, role })
    })

    logger.info({ userId: user.id, targetKey, targetId: userId, role }, 'command target member added')
    return { targetKey }
  })

/** 直接メンバーのロール変更。グループ経由メンバーへの付与もここを通る(行が無ければ作られる) */
export const updateCommandTargetMemberRoleAction = safeAuthAction
  .metadata({ actionName: 'updateCommandTargetMemberRole', role: 'admin' })
  .inputSchema(scUpsertCommandTargetMember)
  .action(async ({ parsedInput: { targetKey, userId, role }, ctx: { user } }) => {
    assertManageableTarget(user, targetKey)
    await prisma.$transaction(async (tx) => {
      await assertCommandAssignmentTargets(tx, { userIds: [userId], groupIds: [] })
      await upsertCommandTargetMember(tx, { targetKey, userId, role })
    })

    logger.info({ userId: user.id, targetKey, targetId: userId, role }, 'command target member role updated')
    return { targetKey }
  })

/** 直接メンバーを外す。グループ経由メンバーは行を持たないため対象外(グループ設定で外す) */
export const removeCommandTargetMemberAction = safeAuthAction
  .metadata({ actionName: 'removeCommandTargetMember', role: 'admin' })
  .inputSchema(scRemoveCommandTargetMember)
  .action(async ({ parsedInput: { targetKey, userId }, ctx: { user } }) => {
    assertManageableTarget(user, targetKey)
    await prisma.$transaction((tx) => removeCommandTargetMember(tx, { targetKey, userId }))

    logger.info({ userId: user.id, targetKey, targetId: userId }, 'command target member removed')
    return { targetKey }
  })

/** グループ単位のアサインを更新する */
export const setCommandTargetGroupsAction = safeAuthAction
  .metadata({ actionName: 'setCommandTargetGroups', role: 'admin' })
  .inputSchema(scSetCommandTargetGroups)
  .action(async ({ parsedInput: { targetKey, groupIds }, ctx: { user } }) => {
    assertManageableTarget(user, targetKey)
    await prisma.$transaction(async (tx) => {
      await assertCommandAssignmentTargets(tx, { userIds: [], groupIds })
      await syncCommandTargetGroups(tx, targetKey, groupIds)
    })

    logger.info({ userId: user.id, targetKey }, 'command target groups updated')
    return { targetKey }
  })

/**
 * 定義に存在しないターゲットのアサインを消す。
 *
 * 自動では消さない。カタログはファイルシステム依存なので、マウント漏れの一時障害でも
 * 「全ターゲットが消えた」ように見えてしまう。消す対象は管理者が名指しで指定する。
 */
export const purgeOrphanCommandAssignsAction = safeAuthAction
  .metadata({ actionName: 'purgeOrphanCommandAssigns', role: 'admin' })
  .inputSchema(scCommandTargetKey)
  .action(async ({ parsedInput: { targetKey }, ctx: { user } }) => {
    // 定義に「ある」ターゲットを消させない。一覧を見た後に定義が戻っている場合がある
    if (getCommandCatalog().catalog.files.some((file) => file.target.id === targetKey)) {
      throw errInvalidOperation()
    }

    const deleted = await deleteCommandTargetAssignments(targetKey)
    logger.warn({ userId: user.id, targetKey, ...deleted }, 'orphan command target assignments purged')
    return deleted
  })
