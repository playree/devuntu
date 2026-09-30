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
  addBoardGithubRepository as addBoardGithubRepositoryCore,
  addBoardGitlabRepository as addBoardGitlabRepositoryCore,
  getBoardAgentAutoRevise as getBoardAgentAutoReviseCore,
  getBoardGithub as getBoardGithubCore,
  getBoardGitlab as getBoardGitlabCore,
  regenerateGithubSecret as regenerateGithubSecretCore,
  regenerateGitlabToken as regenerateGitlabTokenCore,
  removeBoardRepository as removeBoardRepositoryCore,
  setBoardAgentAutoRevise as setBoardAgentAutoReviseCore,
  setBoardCompleteOnPrMerge as setBoardCompleteOnPrMergeCore,
  setGitlabSigningToken as setGitlabSigningTokenCore,
} from '@/lib/board/board-repository'
import {
  assertBoardNotifyManageable,
  deleteBoard as deleteBoardCore,
  getBoardDetail as getBoardDetailCore,
  getBoardNotify as getBoardNotifyCore,
  setBoardAiContext as setBoardAiContextCore,
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
import {
  createTicketTemplate as createTicketTemplateCore,
  deleteTicketTemplate as deleteTicketTemplateCore,
  listBoardTicketTemplates,
  updateTicketTemplate as updateTicketTemplateCore,
} from '@/lib/board/ticket-template'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { assertRateLimit } from '@/lib/rate-limit'
import { scUUID } from '@/lib/schema/schema'
import {
  scAddBoardGitlabRepository,
  scAddBoardRepository,
  scBoardRepositoryTarget,
  scGetBoardSlackChannels,
  scRemoveBoardMember,
  scSetBoardAgentAutoRevise,
  scSetBoardAiContext,
  scSetBoardArchived,
  scSetBoardCompleteOnPrMerge,
  scSetBoardGroups,
  scSetBoardNotifySetting,
  scSetGitlabSigningToken,
  scUpdateBoard,
  scUpsertBoardMember,
} from '@/lib/schema/schema-board'
import { scCreateTag, scUpdateTag } from '@/lib/schema/schema-ticket'
import { scCreateTicketTemplate, scUpdateTicketTemplate } from '@/lib/schema/schema-ticket-template'
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

/** AI 向けコンテキストの更新(owner または管理者) */
export const setBoardAiContext = safeAuthAction
  .metadata({ actionName: 'setBoardAiContext', role: 'user' })
  .inputSchema(scSetBoardAiContext)
  .action(async ({ ctx: { user }, parsedInput: { id, aiContext } }) => {
    await setBoardAiContextCore(user, id, aiContext)
    return { id }
  })

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
 * Git 連携(GitHub / GitLab)
 * -----------------------------------------------------------------------------------------------*/

/** GitHub の対応付けたリポジトリ・マージで完了の設定と、Webhook の登録先(owner または管理者) */
export const getBoardGithub = safeAuthAction
  .metadata({ actionName: 'getBoardGithub', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await getBoardGithubCore(user, id))
export type GetBoardGithubReturnType = Awaited<ReturnType<typeof getBoardGithub>>['data']

/** GitLab の対応付けたプロジェクト・マージで完了の設定と、Webhook の登録先(owner または管理者) */
export const getBoardGitlab = safeAuthAction
  .metadata({ actionName: 'getBoardGitlab', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await getBoardGitlabCore(user, id))
export type GetBoardGitlabReturnType = Awaited<ReturnType<typeof getBoardGitlab>>['data']

/** GitHub のリポジトリの対応付け(owner または管理者)。作ったシークレットを1回だけ返す */
export const addBoardGithubRepository = safeAuthAction
  .metadata({ actionName: 'addBoardGithubRepository', role: 'user' })
  .inputSchema(scAddBoardRepository)
  .action(async ({ ctx: { user }, parsedInput: { id, repo } }) => await addBoardGithubRepositoryCore(user, id, repo))

/** GitHub の Webhook のシークレットの作り直し(owner または管理者)。作ったシークレットを1回だけ返す */
export const regenerateGithubSecret = safeAuthAction
  .metadata({ actionName: 'regenerateGithubSecret', role: 'user' })
  .inputSchema(scBoardRepositoryTarget)
  .action(
    async ({ ctx: { user }, parsedInput: { id, repositoryId } }) =>
      await regenerateGithubSecretCore(user, id, repositoryId),
  )

/** GitLab のプロジェクトの対応付け(owner または管理者)。シークレットトークン方式なら作ったトークンを1回だけ返す */
export const addBoardGitlabRepository = safeAuthAction
  .metadata({ actionName: 'addBoardGitlabRepository', role: 'user' })
  .inputSchema(scAddBoardGitlabRepository)
  .action(
    async ({ ctx: { user }, parsedInput: { id, baseUrl, project, webhookAuth } }) =>
      await addBoardGitlabRepositoryCore(user, id, { baseUrl, project, webhookAuth }),
  )

/** GitLab が作った署名トークンの保存(owner または管理者) */
export const setGitlabSigningToken = safeAuthAction
  .metadata({ actionName: 'setGitlabSigningToken', role: 'user' })
  .inputSchema(scSetGitlabSigningToken)
  .action(async ({ ctx: { user }, parsedInput: { id, repositoryId, secret } }) => {
    await setGitlabSigningTokenCore(user, id, repositoryId, secret)
    return { id }
  })

/** GitLab のシークレットトークンの作り直し(owner または管理者)。作ったトークンを1回だけ返す */
export const regenerateGitlabToken = safeAuthAction
  .metadata({ actionName: 'regenerateGitlabToken', role: 'user' })
  .inputSchema(scBoardRepositoryTarget)
  .action(
    async ({ ctx: { user }, parsedInput: { id, repositoryId } }) =>
      await regenerateGitlabTokenCore(user, id, repositoryId),
  )

/** リポジトリの対応付けの解除(owner または管理者) */
export const removeBoardRepository = safeAuthAction
  .metadata({ actionName: 'removeBoardRepository', role: 'user' })
  .inputSchema(scBoardRepositoryTarget)
  .action(async ({ ctx: { user }, parsedInput: { id, repositoryId } }) => {
    await removeBoardRepositoryCore(user, id, repositoryId)
    return { id }
  })

/** PR / MR のマージでチケットを完了にするかの切り替え(provider ごと。owner または管理者) */
export const setBoardCompleteOnPrMerge = safeAuthAction
  .metadata({ actionName: 'setBoardCompleteOnPrMerge', role: 'user' })
  .inputSchema(scSetBoardCompleteOnPrMerge)
  .action(async ({ ctx: { user }, parsedInput: { id, provider, completeOnMerge } }) => {
    await setBoardCompleteOnPrMergeCore(user, id, provider, completeOnMerge)
    return { id }
  })

/** エージェントへの自動差し戻し(CI の失敗・レビュー指摘)の設定(owner または管理者) */
export const getBoardAgentAutoRevise = safeAuthAction
  .metadata({ actionName: 'getBoardAgentAutoRevise', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await getBoardAgentAutoReviseCore(user, id))

export const setBoardAgentAutoRevise = safeAuthAction
  .metadata({ actionName: 'setBoardAgentAutoRevise', role: 'user' })
  .inputSchema(scSetBoardAgentAutoRevise)
  .action(async ({ ctx: { user }, parsedInput: { id, enabled, limit } }) => {
    await setBoardAgentAutoReviseCore(user, id, { enabled, limit })
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

/* -------------------------------------------------------------------------------------------------
 * チケットテンプレート
 * -----------------------------------------------------------------------------------------------*/

/** テンプレート一覧。閲覧はメンバーなら可能 */
export const getBoardTicketTemplates = safeAuthAction
  .metadata({ actionName: 'getBoardTicketTemplates', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => listBoardTicketTemplates(user, id))
export type GetBoardTicketTemplatesReturnType = Awaited<ReturnType<typeof getBoardTicketTemplates>>['data']

/** テンプレート追加(owner または管理者) */
export const createBoardTicketTemplate = safeAuthAction
  .metadata({ actionName: 'createBoardTicketTemplate', role: 'user' })
  .inputSchema(scCreateTicketTemplate)
  .action(async ({ ctx: { user }, parsedInput }) => await createTicketTemplateCore(user, parsedInput))

/** テンプレート更新(owner または管理者) */
export const updateBoardTicketTemplate = safeAuthAction
  .metadata({ actionName: 'updateBoardTicketTemplate', role: 'user' })
  .inputSchema(scUpdateTicketTemplate)
  .action(async ({ ctx: { user }, parsedInput }) => await updateTicketTemplateCore(user, parsedInput))

/** テンプレート削除(owner または管理者) */
export const deleteBoardTicketTemplate = safeAuthAction
  .metadata({ actionName: 'deleteBoardTicketTemplate', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await deleteTicketTemplateCore(user, id)
    return { id }
  })
