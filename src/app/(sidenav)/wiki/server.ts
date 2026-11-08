'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { scCreateWikiSpace, scGetWikiSpaces } from '@/lib/schema/schema-wiki'
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
