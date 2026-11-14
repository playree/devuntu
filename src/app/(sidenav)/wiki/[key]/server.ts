'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { envu } from '@/lib/env-util'
import { scUUID } from '@/lib/schema/schema'
import {
  scCreateWikiPage,
  scCreateWikiTag,
  scDeleteWikiPage,
  scGetWikiPageRevisionSnapshot,
  scMoveWikiPage,
  scWikiSpaceKey,
} from '@/lib/schema/schema-wiki'
import { designDocFrontMatter } from '@/lib/wiki/wiki-markdown'
import {
  createWikiPage as createWikiPageCore,
  deleteWikiPage as deleteWikiPageCore,
  getWikiTree,
  moveWikiPage as moveWikiPageCore,
  restoreWikiPageRevision as restoreWikiPageRevisionCore,
} from '@/lib/wiki/wiki-page'
import {
  deleteWikiPageRevision as deleteWikiPageRevisionCore,
  getWikiPageRevisionContent as getWikiPageRevisionContentCore,
  getWikiPageRevisionSnapshot as getWikiPageRevisionSnapshotCore,
  listDeletedWikiPages,
  listWikiPageRevisions,
} from '@/lib/wiki/wiki-revision'
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

/** ページの作成。親の子(親が無ければスペース直下)の末尾に置く。設計書は最小の front matter を入れて作る */
export const createWikiPage = safeAuthAction
  .metadata({ actionName: 'createWikiPage', role: 'user' })
  .inputSchema(scCreateWikiPage)
  .action(
    async ({ ctx: { user }, parsedInput: { spaceId, parentId, title, type } }) =>
      await createWikiPageCore(user, WEB, spaceId, {
        title,
        parentId,
        type,
        // 設計書は最小の front matter から書き始める(ビューアの設計書ヘッダになる)
        content: type === 'design_doc' ? designDocFrontMatter(title) : '',
      }),
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

/**
 * ページの版の一覧(本文なし、新しい順)と、同じ時点のページの更新日時。
 * 保持期間(日)・期限を過ぎても残す直近の版の数・1ページあたりの版の上限も返す。削除済みのページも引ける。`id` はページ ID
 */
export const getWikiPageRevisions = safeAuthAction
  .metadata({ actionName: 'getWikiPageRevisions', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => ({
    ...(await listWikiPageRevisions(user, id)),
    retentionDays: envu.server.WIKI_REVISION_RETENTION_DAYS,
    keepRecent: envu.server.WIKI_REVISION_KEEP_RECENT,
    maxPerPage: envu.server.WIKI_REVISION_MAX_PER_PAGE,
  }))
export type GetWikiPageRevisionsReturnType = Awaited<ReturnType<typeof getWikiPageRevisions>>['data']

/** 版の本文。`id` は版 ID */
export const getWikiPageRevisionContent = safeAuthAction
  .metadata({ actionName: 'getWikiPageRevisionContent', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => getWikiPageRevisionContentCore(user, id))

/** 版の内容(タイトル・種類・タグ名・本文など)。印刷用ページで過去の版を出すときに使う */
export const getWikiPageRevisionSnapshot = safeAuthAction
  .metadata({ actionName: 'getWikiPageRevisionSnapshot', role: 'user' })
  .inputSchema(scGetWikiPageRevisionSnapshot)
  .action(async ({ ctx: { user }, parsedInput: { pageId, revisionId } }) =>
    getWikiPageRevisionSnapshotCore(user, pageId, revisionId),
  )

/** 版の削除(編集者以上)。最新の版は消せない。`id` は版 ID */
export const deleteWikiPageRevision = safeAuthAction
  .metadata({ actionName: 'deleteWikiPageRevision', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await deleteWikiPageRevisionCore(user, id)
    // 戻り値が無いと parseAction が失敗として扱うので、消した版の ID を返す
    return { id }
  })

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
