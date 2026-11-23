'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { envu } from '@/lib/env-util'
import { scUUID } from '@/lib/schema/schema'
import {
  scCreateWikiPage,
  scCreateWikiTag,
  scDeleteWikiPage,
  scMoveWikiPage,
  scReorderWikiPage,
  scWikiSpaceKey,
} from '@/lib/schema/schema-wiki'
import { getWikiDesignDocIndex as getWikiDesignDocIndexCore } from '@/lib/wiki/wiki-design-doc-index'
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
  listDeletedWikiPages,
  listWikiPageRevisions,
} from '@/lib/wiki/wiki-revision'
import { getWikiSpaceByKeyForManage } from '@/lib/wiki/wiki-space'
import { createWikiTag as createWikiTagCore, listWikiTags } from '@/lib/wiki/wiki-tag'
import { listWikiTemplateOptions, renderWikiTemplate } from '@/lib/wiki/wiki-template'
import { applyWikiTemplatePlaceholders } from '@/lib/wiki/wiki-template-rule'

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

/**
 * ページの作成。親の子(親が無ければスペース直下)の末尾に置く。
 * テンプレートを指定すると、種類と本文はテンプレートのもの(プレースホルダーを置き換える)にし、タイトルにも置き換えをかける。
 * 本文が空の設計書は最小の front matter を入れて作る(ビューアの設計書ヘッダになる)
 */
export const createWikiPage = safeAuthAction
  .metadata({ actionName: 'createWikiPage', role: 'user' })
  .inputSchema(scCreateWikiPage)
  .action(async ({ ctx: { user }, parsedInput: { spaceId, parentId, title, type, templateId } }) => {
    const now = new Date()
    const template = templateId ? await renderWikiTemplate(user, spaceId, { id: templateId }, now) : null
    const pageTitle = template ? applyWikiTemplatePlaceholders(title, template.context) : title
    const pageType = template?.type ?? type
    const content = template?.content ?? ''
    return await createWikiPageCore(user, WEB, spaceId, {
      title: pageTitle,
      parentId,
      type: pageType,
      content: pageType === 'design_doc' && content === '' ? designDocFrontMatter(pageTitle) : content,
    })
  })

/** ページ作成で選べるテンプレート(本文なし)。editor 以上かつ未アーカイブ。`id` はスペース ID */
export const getWikiTemplateOptions = safeAuthAction
  .metadata({ actionName: 'getWikiTemplateOptions', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await listWikiTemplateOptions(user, id))

/**
 * 移動。`afterId` の兄弟の直後へ置き、null なら先頭、省略で末尾。
 * そのページが移動先の兄弟にいなければ(画面を開いた後に移された・消された)WIKI_TREE_CHANGED で弾く
 */
export const moveWikiPage = safeAuthAction
  .metadata({ actionName: 'moveWikiPage', role: 'user' })
  .inputSchema(scMoveWikiPage)
  .action(
    async ({ ctx: { user }, parsedInput: { id, parentId, afterId } }) =>
      await moveWikiPageCore(user, WEB, id, afterId === null ? { parentId, position: 0 } : { parentId, afterId }),
  )

/** 同じ親の中での並べ替え。画面で見ていた親・兄弟の並びが今と違えば WIKI_TREE_CHANGED で弾く */
export const reorderWikiPage = safeAuthAction
  .metadata({ actionName: 'reorderWikiPage', role: 'user' })
  .inputSchema(scReorderWikiPage)
  .action(
    async ({ ctx: { user }, parsedInput: { id, parentId, siblingIds, position } }) =>
      await moveWikiPageCore(user, WEB, id, { position }, { expectedPlace: { parentId, siblingIds } }),
  )

/** 削除。確認で見せた配下のページが今と違えば WIKI_TREE_CHANGED で弾く。配下があれば配下ごと消す */
export const deleteWikiPage = safeAuthAction
  .metadata({ actionName: 'deleteWikiPage', role: 'user' })
  .inputSchema(scDeleteWikiPage)
  .action(
    async ({ ctx: { user }, parsedInput: { id, descendantIds } }) =>
      await deleteWikiPageCore(user, WEB, id, {
        recursive: descendantIds.length > 0,
        expectedDescendantIds: descendantIds,
      }),
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

/** 版の削除(`canDeleteWikiRevision`: owner と管理者)。最新の版は消せない。`id` は版 ID */
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

/** 設計書スペースのトップの設計書一覧。`id` はスペース ID */
export const getWikiDesignDocIndex = safeAuthAction
  .metadata({ actionName: 'getWikiDesignDocIndex', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => getWikiDesignDocIndexCore(user, id))

/** 版の内容へ戻す。存在するページは本文系だけ、削除済みのページは作り直す。`id` は版 ID */
export const restoreWikiPageRevision = safeAuthAction
  .metadata({ actionName: 'restoreWikiPageRevision', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => restoreWikiPageRevisionCore(user, WEB, id))

/**
 * 削除済みのページの一覧からの復元。`id` は最後の削除の版 ID。
 * 一覧を開いた後に別の人が戻したページは上書きせず unchanged を返す
 */
export const restoreDeletedWikiPage = safeAuthAction
  .metadata({ actionName: 'restoreDeletedWikiPage', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) =>
    restoreWikiPageRevisionCore(user, WEB, id, { deletedOnly: true }),
  )
