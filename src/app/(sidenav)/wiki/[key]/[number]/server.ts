'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { scGetWikiPage, scUpdateWikiPage } from '@/lib/schema/schema-wiki'
import { getWikiPage as getWikiPageCore, updateWikiPage as updateWikiPageCore } from '@/lib/wiki/wiki-page'

/** ページ詳細(パンくず・子ページ付き)。ツリーはサイドメニューが別に持つので返さない */
export const getWikiPage = safeAuthAction
  .metadata({ actionName: 'getWikiPage', role: 'user' })
  .inputSchema(scGetWikiPage)
  .action(async ({ ctx: { user }, parsedInput: { key, number } }) => {
    const { tree: _tree, ...detail } = await getWikiPageCore(user, key, number)
    return detail
  })
export type GetWikiPageReturnType = Awaited<ReturnType<typeof getWikiPage>>['data']

/** タイトル・本文・種類・タグの保存(任意でコミットメッセージ)。読み込んだ後に他の人が保存していれば WIKI_PAGE_CONFLICT */
export const updateWikiPage = safeAuthAction
  .metadata({ actionName: 'updateWikiPage', role: 'user' })
  .inputSchema(scUpdateWikiPage)
  .action(
    async ({ ctx: { user }, parsedInput: { id, title, content, type, tagIds, expectedUpdatedAt, message } }) =>
      await updateWikiPageCore(
        user,
        { via: 'web' },
        id,
        { title, content, type, tagIds },
        { expectedUpdatedAt, message },
      ),
  )
