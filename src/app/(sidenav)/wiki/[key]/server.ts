'use server'

import { safeAuthAction } from '@/lib/action/action-server'
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
} from '@/lib/wiki/wiki-page'
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
