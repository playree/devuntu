'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { scUUID } from '@/lib/schema/schema'
import {
  scRemoveWikiSpaceMember,
  scRemoveWikiSpaceTarget,
  scSetWikiSpaceArchived,
  scUpdateWikiSpace,
  scUpsertWikiSpaceMember,
  scUpsertWikiSpaceTarget,
} from '@/lib/schema/schema-wiki'
import {
  getWikiSpaceAssignments as getWikiSpaceAssignmentsCore,
  getWikiSpaceAssignOptions as getWikiSpaceAssignOptionsCore,
  removeWikiSpaceBoard as removeWikiSpaceBoardCore,
  removeWikiSpaceGroup as removeWikiSpaceGroupCore,
  removeWikiSpaceMember as removeWikiSpaceMemberCore,
  upsertWikiSpaceBoard as upsertWikiSpaceBoardCore,
  upsertWikiSpaceGroup as upsertWikiSpaceGroupCore,
  upsertWikiSpaceMember as upsertWikiSpaceMemberCore,
} from '@/lib/wiki/wiki-assignment'
import {
  setWikiSpaceArchived as setWikiSpaceArchivedCore,
  updateWikiSpace as updateWikiSpaceCore,
} from '@/lib/wiki/wiki-space'

/**
 * スペース設定画面の Server Action。どれも manage(owner または管理者)を要求する。
 * 処理本体と権限の検証は `@/lib/wiki/wiki-space` / `wiki-assignment` にある。
 */

/** 名前・説明・公開範囲 */
export const updateWikiSpace = safeAuthAction
  .metadata({ actionName: 'updateWikiSpace', role: 'user' })
  .inputSchema(scUpdateWikiSpace)
  .action(async ({ ctx: { user }, parsedInput: { id, ...patch } }) => await updateWikiSpaceCore(user, id, patch))

export const setWikiSpaceArchived = safeAuthAction
  .metadata({ actionName: 'setWikiSpaceArchived', role: 'user' })
  .inputSchema(scSetWikiSpaceArchived)
  .action(async ({ ctx: { user }, parsedInput: { id, archived } }) => {
    await setWikiSpaceArchivedCore(user, id, archived)
    return { id }
  })

/** 割り当ての一覧(直接メンバー / グループ / ボード) */
export const getWikiSpaceAssignments = safeAuthAction
  .metadata({ actionName: 'getWikiSpaceAssignments', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await getWikiSpaceAssignmentsCore(user, id))
export type GetWikiSpaceAssignmentsReturnType = Awaited<ReturnType<typeof getWikiSpaceAssignments>>['data']

/** 割り当ての候補 */
export const getWikiSpaceAssignOptions = safeAuthAction
  .metadata({ actionName: 'getWikiSpaceAssignOptions', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await getWikiSpaceAssignOptionsCore(user, id))

/** ユーザーの直接割り当て(追加とロール変更を兼ねる) */
export const upsertWikiSpaceMember = safeAuthAction
  .metadata({ actionName: 'upsertWikiSpaceMember', role: 'user' })
  .inputSchema(scUpsertWikiSpaceMember)
  .action(async ({ ctx: { user }, parsedInput: { id, userId, role } }) => {
    await upsertWikiSpaceMemberCore(user, { spaceId: id, userId, role })
    return { id }
  })

export const removeWikiSpaceMember = safeAuthAction
  .metadata({ actionName: 'removeWikiSpaceMember', role: 'user' })
  .inputSchema(scRemoveWikiSpaceMember)
  .action(async ({ ctx: { user }, parsedInput: { id, userId } }) => {
    await removeWikiSpaceMemberCore(user, { spaceId: id, userId })
    return { id }
  })

export const upsertWikiSpaceGroup = safeAuthAction
  .metadata({ actionName: 'upsertWikiSpaceGroup', role: 'user' })
  .inputSchema(scUpsertWikiSpaceTarget)
  .action(async ({ ctx: { user }, parsedInput: { id, targetId, role } }) => {
    await upsertWikiSpaceGroupCore(user, { spaceId: id, groupId: targetId, role })
    return { id }
  })

export const removeWikiSpaceGroup = safeAuthAction
  .metadata({ actionName: 'removeWikiSpaceGroup', role: 'user' })
  .inputSchema(scRemoveWikiSpaceTarget)
  .action(async ({ ctx: { user }, parsedInput: { id, targetId } }) => {
    await removeWikiSpaceGroupCore(user, { spaceId: id, groupId: targetId })
    return { id }
  })

export const upsertWikiSpaceBoard = safeAuthAction
  .metadata({ actionName: 'upsertWikiSpaceBoard', role: 'user' })
  .inputSchema(scUpsertWikiSpaceTarget)
  .action(async ({ ctx: { user }, parsedInput: { id, targetId, role } }) => {
    await upsertWikiSpaceBoardCore(user, { spaceId: id, boardId: targetId, role })
    return { id }
  })

export const removeWikiSpaceBoard = safeAuthAction
  .metadata({ actionName: 'removeWikiSpaceBoard', role: 'user' })
  .inputSchema(scRemoveWikiSpaceTarget)
  .action(async ({ ctx: { user }, parsedInput: { id, targetId } }) => {
    await removeWikiSpaceBoardCore(user, { spaceId: id, boardId: targetId })
    return { id }
  })
