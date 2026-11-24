'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { assertRateLimit } from '@/lib/rate-limit'
import { scUUID } from '@/lib/schema/schema'
import {
  scCreateWikiTemplate,
  scGetWikiSlackChannels,
  scMoveWikiTemplate,
  scRemoveWikiSpaceMember,
  scRemoveWikiSpaceTarget,
  scSetWikiAnnounceChannel,
  scSetWikiSpaceArchived,
  scUpdateWikiSpace,
  scUpdateWikiTag,
  scUpdateWikiTemplate,
  scUpsertWikiSpaceMember,
  scUpsertWikiSpaceTarget,
} from '@/lib/schema/schema-wiki'
import { listSlackChannels } from '@/lib/slack/slack-server'
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
  assertWikiAnnounceChannelManageable,
  deleteWikiSpace as deleteWikiSpaceCore,
  getWikiAnnounceChannel as getWikiAnnounceChannelCore,
  setWikiAnnounceChannel as setWikiAnnounceChannelCore,
  setWikiSpaceArchived as setWikiSpaceArchivedCore,
  updateWikiSpace as updateWikiSpaceCore,
} from '@/lib/wiki/wiki-space'
import {
  deleteWikiTag as deleteWikiTagCore,
  listWikiTagsForManage,
  updateWikiTag as updateWikiTagCore,
} from '@/lib/wiki/wiki-tag'
import {
  createWikiTemplate as createWikiTemplateCore,
  deleteWikiTemplate as deleteWikiTemplateCore,
  listWikiTemplatesForManage,
  moveWikiTemplate as moveWikiTemplateCore,
  updateWikiTemplate as updateWikiTemplateCore,
} from '@/lib/wiki/wiki-template'

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

/** スペースの削除。ページ・版・添付もすべて消え、キーは再利用できない */
export const deleteWikiSpace = safeAuthAction
  .metadata({ actionName: 'deleteWikiSpace', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await deleteWikiSpaceCore(user, id)
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

/** タグ管理の一覧(付与しているページ数付き)。作成は `../server.ts` の createWikiTag */
export const getWikiTags = safeAuthAction
  .metadata({ actionName: 'getWikiTags', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await listWikiTagsForManage(user, id))

export const updateWikiTag = safeAuthAction
  .metadata({ actionName: 'updateWikiTag', role: 'user' })
  .inputSchema(scUpdateWikiTag)
  .action(async ({ ctx: { user }, parsedInput }) => await updateWikiTagCore(user, parsedInput))

/** タグの削除。ページとの紐付けも消える */
export const deleteWikiTag = safeAuthAction
  .metadata({ actionName: 'deleteWikiTag', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await deleteWikiTagCore(user, id)
    return { id }
  })

/** ページテンプレートの一覧(本文込み、表示順)。`id` はスペース ID */
export const getWikiTemplates = safeAuthAction
  .metadata({ actionName: 'getWikiTemplates', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await listWikiTemplatesForManage(user, id))
export type GetWikiTemplatesReturnType = Awaited<ReturnType<typeof getWikiTemplates>>['data']

/** テンプレートの追加(末尾に置く) */
export const createWikiTemplate = safeAuthAction
  .metadata({ actionName: 'createWikiTemplate', role: 'user' })
  .inputSchema(scCreateWikiTemplate)
  .action(async ({ ctx: { user }, parsedInput }) => await createWikiTemplateCore(user, parsedInput))

export const updateWikiTemplate = safeAuthAction
  .metadata({ actionName: 'updateWikiTemplate', role: 'user' })
  .inputSchema(scUpdateWikiTemplate)
  .action(async ({ ctx: { user }, parsedInput }) => await updateWikiTemplateCore(user, parsedInput))

export const deleteWikiTemplate = safeAuthAction
  .metadata({ actionName: 'deleteWikiTemplate', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await deleteWikiTemplateCore(user, id)
    return { id }
  })

/** 表示順で隣と入れ替える */
export const moveWikiTemplate = safeAuthAction
  .metadata({ actionName: 'moveWikiTemplate', role: 'user' })
  .inputSchema(scMoveWikiTemplate)
  .action(async ({ ctx: { user }, parsedInput: { id, direction } }) => {
    await moveWikiTemplateCore(user, id, direction)
    return { id }
  })

/** Slack のチャンネル一覧の取り直しの上限(ボード設定と同じ) */
const CHANNELS_REFRESH_RATE_LIMIT = { limit: 10, windowMs: 60 * 1000 }

/**
 * アナウンスの通知先に選べる Slack チャンネルの一覧(owner または管理者)。取得できない場合は null。
 * `force` はキャッシュを捨てて取り直す(Bot を招待した直後に選べるようにするため)
 */
export const getWikiSlackChannels = safeAuthAction
  .metadata({ actionName: 'getWikiSlackChannels', role: 'user' })
  .inputSchema(scGetWikiSlackChannels)
  .action(async ({ ctx: { user }, parsedInput: { id, force } }) => {
    await assertWikiAnnounceChannelManageable(user, id)
    if (force) {
      assertRateLimit(`slack-channels-refresh:${user.id}`, CHANNELS_REFRESH_RATE_LIMIT)
    }
    return listSlackChannels({ force })
  })
export type GetWikiSlackChannelsReturnType = Awaited<ReturnType<typeof getWikiSlackChannels>>['data']

/** アナウンスの通知先チャンネルの現在値 */
export const getWikiAnnounceChannel = safeAuthAction
  .metadata({ actionName: 'getWikiAnnounceChannel', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await getWikiAnnounceChannelCore(user, id))
export type GetWikiAnnounceChannelReturnType = Awaited<ReturnType<typeof getWikiAnnounceChannel>>['data']

/** アナウンスの通知先チャンネルの設定・解除(空文字で解除) */
export const setWikiAnnounceChannel = safeAuthAction
  .metadata({ actionName: 'setWikiAnnounceChannel', role: 'user' })
  .inputSchema(scSetWikiAnnounceChannel)
  .action(async ({ ctx: { user }, parsedInput: { id, slackChannelId } }) => {
    await setWikiAnnounceChannelCore(user, id, slackChannelId || null)
    return { id }
  })
