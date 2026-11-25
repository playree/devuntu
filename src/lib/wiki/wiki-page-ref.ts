/**
 * Wiki ページの参照(`KEY/番号`)の解決(サーバー専用)。MCP の入力で使う
 */

import type { Actor } from '../board/board-access'
import { errValidation } from '../error'
import { findWikiPageByNumber } from './wiki-page'
import { parseWikiPageRef, wikiPageRef } from './wiki-rule'
import { getWikiSpaceByKey } from './wiki-space'

/**
 * `KEY/番号` のページを引く。スペースの権限を先に確かめてからページの有無を見る(他のスペースのページの有無を探らせない)。
 * 形が不正なら errValidation(`field` は入力の項目名)。ページが無ければ page は null
 */
export const resolveWikiPageRef = async (actor: Actor, ref: string, need: 'view' | 'write', field = 'ref') => {
  const parsed = parseWikiPageRef(ref)
  if (!parsed) {
    throw errValidation(`${field} must be KEY/number (e.g. DOCS/12), got ${ref}`)
  }
  const { access } = await getWikiSpaceByKey(actor, parsed.key, need)
  const found = await findWikiPageByNumber(access.spaceId, parsed.number)
  const page = found && { ...found, number: parsed.number }
  return { access, ref: wikiPageRef({ key: access.key, number: parsed.number }), page }
}
