'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { assertBoardAccess } from '@/lib/board/board-access'
import {
  getBoardAssignments as getBoardAssignmentsCore,
  removeBoardMember as removeBoardMemberCore,
  setBoardGroups as setBoardGroupsCore,
  upsertBoardMember,
} from '@/lib/board/board-assignment'
import { getBoardMemberUsers } from '@/lib/board/board-member'
import {
  assertBoardNotifyManageable,
  deleteBoard as deleteBoardCore,
  getBoardDetail as getBoardDetailCore,
  getBoardNotify as getBoardNotifyCore,
  setBoardArchivedState,
  setBoardNotify as setBoardNotifyCore,
  updateBoardProfile,
} from '@/lib/board/board-setting'
import {
  createBoardTag as createBoardTagCore,
  deleteBoardTag as deleteBoardTagCore,
  listBoardTagsForManage,
  updateBoardTag as updateBoardTagCore,
} from '@/lib/board/tag'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { assertRateLimit } from '@/lib/rate-limit'
import { scUUID } from '@/lib/schema/schema'
import {
  scGetBoardSlackChannels,
  scRemoveBoardMember,
  scSetBoardArchived,
  scSetBoardGroups,
  scSetBoardNotifySetting,
  scUpdateBoard,
  scUpsertBoardMember,
} from '@/lib/schema/schema-board'
import { scCreateTag, scUpdateTag } from '@/lib/schema/schema-ticket'
import { listSlackChannels } from '@/lib/slack/slack-server'

/**
 * ボード設定画面の Server Action。
 * 処理本体と権限の検証は `@/lib/board/board-setting` / `board-assignment` / `tag` にある。
 */

/**
 * チャンネル一覧の強制再取得の連打防止。
 * キャッシュは Slack を叩く回数を抑えるための仕組みなので、迂回する経路には歯止めを置く
 * (1 回の取得で最大 CHANNELS_MAX_PAGES 回 Slack を呼ぶ)。
 */
const CHANNELS_REFRESH_RATE_LIMIT = { limit: 10, windowMs: 60 * 1000 }

/** ボード詳細(概要 + 権限)。メンバー一覧は独立してリロードできるよう getBoardMembers に分けている */
export const getBoardDetail = safeAuthAction
  .metadata({ actionName: 'getBoardDetail', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await getBoardDetailCore(user, id))
export type GetBoardDetailReturnType = Awaited<ReturnType<typeof getBoardDetail>>['data']

/** メンバー一覧(グループ経由も含む)。閲覧はメンバーなら可能 */
export const getBoardMembers = safeAuthAction
  .metadata({ actionName: 'getBoardMembers', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await assertBoardAccess(user, id, 'view')
    return getBoardMemberUsers(id)
  })
export type GetBoardMembersReturnType = Awaited<ReturnType<typeof getBoardMembers>>['data']

/** ボード更新(owner または管理者)。プライベートボードは変更できない */
export const updateBoard = safeAuthAction
  .metadata({ actionName: 'updateBoard', role: 'user' })
  .inputSchema(scUpdateBoard)
  .action(async ({ ctx: { user }, parsedInput }) => await updateBoardProfile(user, parsedInput))

/** アーカイブの切り替え(owner または管理者) */
export const setBoardArchived = safeAuthAction
  .metadata({ actionName: 'setBoardArchived', role: 'user' })
  .inputSchema(scSetBoardArchived)
  .action(async ({ ctx: { user }, parsedInput: { id, archived } }) => {
    await setBoardArchivedState(user, id, archived)
    return { id }
  })

/**
 * 通知先に選べる Slack チャンネルの一覧(owner または管理者)。
 *
 * Bot が参加している会話だけが返るので、招待漏れのチャンネルを選んでしまうことはない
 * (参加していても read-only channel などで投稿を拒否されることはある)。取得できない場合は null。
 * `force` はキャッシュを捨てて取り直す(Bot を招待した直後に選べるようにするため)。
 */
export const getBoardSlackChannels = safeAuthAction
  .metadata({ actionName: 'getBoardSlackChannels', role: 'user' })
  .inputSchema(scGetBoardSlackChannels)
  .action(async ({ ctx: { user }, parsedInput: { id, force } }) => {
    await assertBoardNotifyManageable(user, id, prisma)

    if (force) {
      assertRateLimit(`slack-channels-refresh:${user.id}`, CHANNELS_REFRESH_RATE_LIMIT)
    }
    return listSlackChannels({ force })
  })
export type GetBoardSlackChannelsReturnType = Awaited<ReturnType<typeof getBoardSlackChannels>>['data']

/** ボードのチャネル通知の現在値(owner または管理者) */
export const getBoardNotify = safeAuthAction
  .metadata({ actionName: 'getBoardNotify', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await getBoardNotifyCore(user, id))
export type GetBoardNotifyReturnType = Awaited<ReturnType<typeof getBoardNotify>>['data']

/** ボードのチャネル通知の設定(owner または管理者) */
export const setBoardNotify = safeAuthAction
  .metadata({ actionName: 'setBoardNotify', role: 'user' })
  .inputSchema(scSetBoardNotifySetting)
  .action(async ({ ctx: { user }, parsedInput }) => {
    await setBoardNotifyCore(user, parsedInput)
    return { id: parsedInput.id }
  })

/** ボード削除(owner または管理者)。チケット / タグ / アサインは Cascade で消える */
export const deleteBoard = safeAuthAction
  .metadata({ actionName: 'deleteBoard', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await deleteBoardCore(user, id)
    return { id }
  })

/* -------------------------------------------------------------------------------------------------
 * アサイン
 * -----------------------------------------------------------------------------------------------*/

/** アサイン編集フォームの初期値(直接メンバー + グループ + 選択肢) */
export const getBoardAssignments = safeAuthAction
  .metadata({ actionName: 'getBoardAssignments', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await getBoardAssignmentsCore(user, id))
export type GetBoardAssignmentsReturnType = Awaited<ReturnType<typeof getBoardAssignments>>['data']

/** メンバーを 1 人追加する(owner または管理者)。既に直接メンバーならロールを上書きする */
export const addBoardMember = safeAuthAction
  .metadata({ actionName: 'addBoardMember', role: 'user' })
  .inputSchema(scUpsertBoardMember)
  .action(async ({ ctx: { user }, parsedInput: { id, userId, role } }) => {
    await upsertBoardMember(user, { boardId: id, userId, role })

    logger.info({ userId: user.id, id, targetId: userId, role }, 'board member added')
    return { id }
  })

/** メンバーのロールを変更する(owner または管理者) */
export const updateBoardMemberRole = safeAuthAction
  .metadata({ actionName: 'updateBoardMemberRole', role: 'user' })
  .inputSchema(scUpsertBoardMember)
  .action(async ({ ctx: { user }, parsedInput: { id, userId, role } }) => {
    await upsertBoardMember(user, { boardId: id, userId, role })

    logger.info({ userId: user.id, id, targetId: userId, role }, 'board member role updated')
    return { id }
  })

/** 直接メンバーを外す(owner または管理者) */
export const removeBoardMember = safeAuthAction
  .metadata({ actionName: 'removeBoardMember', role: 'user' })
  .inputSchema(scRemoveBoardMember)
  .action(async ({ ctx: { user }, parsedInput: { id, userId } }) => {
    await removeBoardMemberCore(user, { boardId: id, userId })
    return { id }
  })

/** グループ単位のアサインを更新する(管理者のみ) */
export const setBoardGroups = safeAuthAction
  .metadata({ actionName: 'setBoardGroups', role: 'user' })
  .inputSchema(scSetBoardGroups)
  .action(async ({ ctx: { user }, parsedInput: { id, groupIds } }) => {
    await setBoardGroupsCore(user, { boardId: id, groupIds })
    return { id }
  })

/* -------------------------------------------------------------------------------------------------
 * タグ
 * -----------------------------------------------------------------------------------------------*/

/** ボードのタグ一覧(使用件数付き)。閲覧はメンバーなら可能 */
export const getBoardTags = safeAuthAction
  .metadata({ actionName: 'getBoardTags', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await assertBoardAccess(user, id, 'view')
    return listBoardTagsForManage(id)
  })
export type GetBoardTagsReturnType = Awaited<ReturnType<typeof getBoardTags>>['data']

/** タグ作成。チケット編集中にも必要になるためメンバー権限で実行できる */
export const createBoardTag = safeAuthAction
  .metadata({ actionName: 'createBoardTag', role: 'user' })
  .inputSchema(scCreateTag)
  .action(async ({ ctx: { user }, parsedInput }) => await createBoardTagCore(user, parsedInput))

/** タグ更新(リネーム / 色 / 表示順)。owner または管理者 */
export const updateBoardTag = safeAuthAction
  .metadata({ actionName: 'updateBoardTag', role: 'user' })
  .inputSchema(scUpdateTag)
  .action(async ({ ctx: { user }, parsedInput }) => await updateBoardTagCore(user, parsedInput))

/** タグ削除(owner または管理者)。TicketTag は Cascade で消える */
export const deleteBoardTag = safeAuthAction
  .metadata({ actionName: 'deleteBoardTag', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await deleteBoardTagCore(user, id)
    return { id }
  })
