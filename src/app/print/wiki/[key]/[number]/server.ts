'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { scGetWikiPageRevisionSnapshot } from '@/lib/schema/schema-wiki'
import { getWikiPageRevisionSnapshot as getWikiPageRevisionSnapshotCore } from '@/lib/wiki/wiki-revision'

/** 版の内容(タイトル・種類・タグ・本文など)。過去の版を出力するときに使う。そのページの版でなければ拒否する */
export const getWikiPageRevisionSnapshot = safeAuthAction
  .metadata({ actionName: 'getWikiPageRevisionSnapshot', role: 'user' })
  .inputSchema(scGetWikiPageRevisionSnapshot)
  .action(async ({ ctx: { user }, parsedInput: { pageId, revisionId } }) =>
    getWikiPageRevisionSnapshotCore(user, pageId, revisionId),
  )
