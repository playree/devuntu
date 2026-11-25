'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { scCreateWikiSpace, scGetWikiSpaces, scWikiSearch } from '@/lib/schema/schema-wiki'
import { MAX_WIKI_SEARCH_LIMIT } from '@/lib/wiki/wiki-rule'
import { searchWikiPages as searchWikiPagesCore } from '@/lib/wiki/wiki-search'
import { createWikiSpace as createWikiSpaceCore, listWikiSpaces } from '@/lib/wiki/wiki-space'

/** 閲覧できるスペースの一覧と、それぞれでの自分の権限 */
export const getWikiSpaces = safeAuthAction
  .metadata({ actionName: 'getWikiSpaces', role: 'user' })
  .inputSchema(scGetWikiSpaces)
  .action(
    async ({ ctx: { user }, parsedInput: { includeArchived } }) => await listWikiSpaces(user, { includeArchived }),
  )
export type GetWikiSpacesReturnType = Awaited<ReturnType<typeof getWikiSpaces>>['data']

/** スペースの作成。作成者が owner になる */
export const createWikiSpace = safeAuthAction
  .metadata({ actionName: 'createWikiSpace', role: 'user' })
  .inputSchema(scCreateWikiSpace)
  .action(async ({ ctx: { user }, parsedInput }) => await createWikiSpaceCore(user, parsedInput))

/** ページの検索。画面では上限まで取り、上限に達したら絞り込みを促す */
export const searchWikiPages = safeAuthAction
  .metadata({ actionName: 'searchWikiPages', role: 'user' })
  .inputSchema(scWikiSearch)
  .action(
    async ({ ctx: { user }, parsedInput: { keyword, space, tags, limit } }) =>
      await searchWikiPagesCore(user, { keyword, space, tags, limit: limit ?? MAX_WIKI_SEARCH_LIMIT }),
  )
export type SearchWikiPagesReturnType = Awaited<ReturnType<typeof searchWikiPages>>['data']
