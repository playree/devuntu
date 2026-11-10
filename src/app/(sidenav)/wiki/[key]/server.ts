'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { envu } from '@/lib/env-util'
import { scUUID } from '@/lib/schema/schema'
import {
  scCreateWikiPage,
  scCreateWikiTag,
  scDeleteWikiPage,
  scMoveWikiPage,
  scWikiSpaceKey,
} from '@/lib/schema/schema-wiki'
import {
  createWikiPage as createWikiPageCore,
  deleteWikiPage as deleteWikiPageCore,
  getWikiTree,
  moveWikiPage as moveWikiPageCore,
  restoreWikiPageRevision as restoreWikiPageRevisionCore,
} from '@/lib/wiki/wiki-page'
import { getWikiPageRevisionContents, listDeletedWikiPages, listWikiPageRevisions } from '@/lib/wiki/wiki-revision'
import { getWikiSpaceByKeyForManage } from '@/lib/wiki/wiki-space'
import { createWikiTag as createWikiTagCore, listWikiTags } from '@/lib/wiki/wiki-tag'

/**
 * スペース内の画面(トップ・ページ・設定)で共通に使う Server Action。
 * 権限の検証は `@/lib/wiki/*` 側で行う(閲覧は viewer 以上、ページの書き込みは editor 以上かつ未アーカイブ)。
 */

const WEB = { via: 'web' } as const

/**
 * スペースの情報と自分の権限、ツリー(本文なし)、タグ。サイドメニューのツリーとスペース内の画面で使う。
 * 割り当ての無い管理者は設定だけを開けるよう、ツリーとタグを空にして返す
 */
export const getWikiSpace = safeAuthAction
  .metadata({ actionName: 'getWikiSpace', role: 'user' })
  .inputSchema(scWikiSpaceKey)
  .action(async ({ ctx: { user }, parsedInput: { key } }) => {
    const { space, access } = await getWikiSpaceByKeyForManage(user, key)
    const [tree, tags] = access.canView
      ? await Promise.all([getWikiTree(user, space.id), listWikiTags(space.id)])
      : [[], []]
    return { space, access, tree, tags }
  })
export type GetWikiSpaceReturnType = Awaited<ReturnType<typeof getWikiSpace>>['data']

/** ページの作成。親の子(親が無ければスペース直下)の末尾に置く */
export const createWikiPage = safeAuthAction
  .metadata({ actionName: 'createWikiPage', role: 'user' })
  .inputSchema(scCreateWikiPage)
  .action(
    async ({ ctx: { user }, parsedInput: { spaceId, parentId, title } }) =>
      await createWikiPageCore(user, WEB, spaceId, { title, parentId }),
  )

/** 移動・並べ替え */
export const moveWikiPage = safeAuthAction
  .metadata({ actionName: 'moveWikiPage', role: 'user' })
  .inputSchema(scMoveWikiPage)
  .action(
    async ({ ctx: { user }, parsedInput: { id, parentId, position } }) =>
      await moveWikiPageCore(user, WEB, id, { parentId, position }),
  )

/** 削除。子孫があるときは recursive で配下ごと消す */
export const deleteWikiPage = safeAuthAction
  .metadata({ actionName: 'deleteWikiPage', role: 'user' })
  .inputSchema(scDeleteWikiPage)
  .action(
    async ({ ctx: { user }, parsedInput: { id, recursive } }) => await deleteWikiPageCore(user, WEB, id, { recursive }),
  )

/** タグの作成(editor 以上)。ページの編集中とスペースの設定で使う */
export const createWikiTag = safeAuthAction
  .metadata({ actionName: 'createWikiTag', role: 'user' })
  .inputSchema(scCreateWikiTag)
  .action(
    async ({ ctx: { user }, parsedInput: { spaceId, ...input } }) => await createWikiTagCore(user, spaceId, input),
  )

/** ページの版の一覧(本文なし、新しい順)と保持期間(日)・期限を過ぎても残す直近の版の数・1ページあたりの版の上限。削除済みのページも引ける。`id` はページ ID */
export const getWikiPageRevisions = safeAuthAction
  .metadata({ actionName: 'getWikiPageRevisions', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => ({
    revisions: await listWikiPageRevisions(user, id),
    retentionDays: envu.server.WIKI_REVISION_RETENTION_DAYS,
    keepRecent: envu.server.WIKI_REVISION_KEEP_RECENT,
    maxPerPage: envu.server.WIKI_REVISION_MAX_PER_PAGE,
  }))
export type GetWikiPageRevisionsReturnType = Awaited<ReturnType<typeof getWikiPageRevisions>>['data']

/** 版の本文と、差分の比較元になる1つ前の版の本文。`id` は版 ID */
export const getWikiPageRevisionDiff = safeAuthAction
  .metadata({ actionName: 'getWikiPageRevisionDiff', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => getWikiPageRevisionContents(user, id))
export type GetWikiPageRevisionDiffReturnType = Awaited<ReturnType<typeof getWikiPageRevisionDiff>>['data']

/** 削除済みのページ(最後に削除された版)と保持期間(日)。`id` はスペース ID */
export const getDeletedWikiPages = safeAuthAction
  .metadata({ actionName: 'getDeletedWikiPages', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => ({
    pages: await listDeletedWikiPages(user, id),
    retentionDays: envu.server.WIKI_REVISION_RETENTION_DAYS,
  }))
export type GetDeletedWikiPagesReturnType = Awaited<ReturnType<typeof getDeletedWikiPages>>['data']

/** 版の内容へ戻す。存在するページは本文系だけ、削除済みのページは作り直す。`id` は版 ID */
export const restoreWikiPageRevision = safeAuthAction
  .metadata({ actionName: 'restoreWikiPageRevision', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => restoreWikiPageRevisionCore(user, WEB, id))
