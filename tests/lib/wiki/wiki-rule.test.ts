/**
 * Wiki の純粋関数(wiki-rule.ts)
 *
 * ロールの解決と権限の評価、版をまとめるかの判定、ページ指定の解析を確かめる。
 */

import {
  evaluateWikiAccess,
  hasWikiRole,
  MAX_WIKI_PAGE_TAGS,
  MAX_WIKI_SEARCH_KEYWORD,
  parseWikiPageRef,
  parseWikiSearchParams,
  pickExpiredWikiRevisionIds,
  resolveWikiRole,
  shouldMergeWikiRevision,
  strongestWikiRole,
  wikiPageRef,
  wikiSearchHref,
  type WikiRevisionOrigin,
} from '@/lib/wiki/wiki-rule'
import { describe, expect, it } from 'vitest'

describe('strongestWikiRole / hasWikiRole', () => {
  it('owner > editor > viewer の順で最も強いものを採る', () => {
    expect(strongestWikiRole(['viewer', 'owner', 'editor'])).toBe('owner')
    expect(strongestWikiRole(['viewer', null, 'editor'])).toBe('editor')
    expect(strongestWikiRole([null, undefined])).toBeNull()
  })

  it('必要なロール以上かを判定する', () => {
    expect(hasWikiRole('owner', 'editor')).toBe(true)
    expect(hasWikiRole('editor', 'editor')).toBe(true)
    expect(hasWikiRole('viewer', 'editor')).toBe(false)
    expect(hasWikiRole(null, 'viewer')).toBe(false)
  })
})

describe('resolveWikiRole', () => {
  const none = { direct: null, groups: [], boards: [], everyone: false }

  it('割り当てが無ければ null', () => {
    expect(resolveWikiRole(none)).toBeNull()
  })

  it('直接・グループ・ボード経由のうち最も強いものを採る', () => {
    expect(resolveWikiRole({ ...none, direct: 'viewer', groups: ['editor'] })).toBe('editor')
    expect(resolveWikiRole({ ...none, boards: ['viewer', 'editor'] })).toBe('editor')
    expect(resolveWikiRole({ ...none, direct: 'owner', boards: ['editor'] })).toBe('owner')
  })

  it('everyone のスペースでは割り当てが無くても viewer、割り当てがあればそちらが勝つ', () => {
    expect(resolveWikiRole({ ...none, everyone: true })).toBe('viewer')
    expect(resolveWikiRole({ ...none, everyone: true, groups: ['editor'] })).toBe('editor')
  })
})

describe('evaluateWikiAccess', () => {
  it.each([
    ['viewer', false, false, { canView: true, canWrite: false, canManage: false }],
    ['editor', false, false, { canView: true, canWrite: true, canManage: false }],
    ['owner', false, false, { canView: true, canWrite: true, canManage: true }],
    // アーカイブ済みは閲覧のみ。設定(アーカイブの解除)は owner が続けて行える
    ['owner', true, false, { canView: true, canWrite: false, canManage: true }],
    ['editor', true, false, { canView: true, canWrite: false, canManage: false }],
    // 管理者は割り当てが無ければ管理だけ
    [null, false, true, { canView: false, canWrite: false, canManage: true }],
    [null, false, false, { canView: false, canWrite: false, canManage: false }],
  ] as const)('role=%s archived=%s admin=%s', (role, archived, isAdmin, expected) => {
    expect(evaluateWikiAccess({ role, archived, isAdmin })).toEqual(expected)
  })
})

describe('shouldMergeWikiRevision', () => {
  const NOW = new Date('2026-11-08T10:00:00.000Z')
  const origin: WikiRevisionOrigin = { action: 'updated', actorId: 'u1', via: 'web', ticketId: null }
  const latest = (override: Partial<WikiRevisionOrigin & { createdAt: Date }> = {}) => ({
    ...origin,
    createdAt: new Date('2026-11-08T09:55:00.000Z'),
    ...override,
  })

  it('同じ人・経路・チケットの updated が時間内に続けばまとめる', () => {
    expect(shouldMergeWikiRevision(latest(), origin, NOW, 10)).toBe(true)
  })

  it('最新の版の作成からちょうど上限の時間まではまとめる', () => {
    expect(shouldMergeWikiRevision(latest({ createdAt: new Date('2026-11-08T09:50:00.000Z') }), origin, NOW, 10)).toBe(
      true,
    )
  })

  it.each([
    ['最新の版が無い', null, origin, 10],
    ['時間を過ぎた', latest({ createdAt: new Date('2026-11-08T09:49:59.999Z') }), origin, 10],
    ['まとめる時間が 0', latest(), origin, 0],
    ['別の人', latest({ actorId: 'u2' }), origin, 10],
    ['別の経路', latest({ via: 'mcp' }), origin, 10],
    ['別のチケット', latest({ ticketId: 't1' }), origin, 10],
    ['最新の版が updated でない', latest({ action: 'created' }), origin, 10],
    ['今回が updated でない', latest(), { ...origin, action: 'moved' }, 10],
  ] as const)('%s ならまとめない', (_, last, next, minutes) => {
    expect(shouldMergeWikiRevision(last, next, NOW, minutes)).toBe(false)
  })
})

describe('wikiPageRef / parseWikiPageRef', () => {
  it('KEY/番号 を組み立て、読み取る(キーは大文字に寄せる)', () => {
    expect(wikiPageRef({ key: 'DOCS', number: 12 })).toBe('DOCS/12')
    expect(parseWikiPageRef('DOCS/12')).toEqual({ key: 'DOCS', number: 12 })
    expect(parseWikiPageRef(' docs/3 ')).toEqual({ key: 'DOCS', number: 3 })
  })

  it.each(['DOCS', 'DOCS/0', 'DOCS/-1', 'D/1', '1DOC/1', 'DOCS/1/2', 'DOCS-12', 'DOCS/1234567890'])(
    '形式外は null (%s)',
    (raw) => {
      expect(parseWikiPageRef(raw)).toBeNull()
    },
  )
})

describe('wikiSearchHref', () => {
  it('スペースがあればスペース内検索、無ければ /wiki の横断検索。タグは繰り返しで持つ', () => {
    expect(wikiSearchHref({ spaceKey: 'DOCS', q: '設計 API', tags: ['仕様', '下書き'] })).toBe(
      '/wiki/DOCS/search?q=%E8%A8%AD%E8%A8%88+API&tags=%E4%BB%95%E6%A7%98&tags=%E4%B8%8B%E6%9B%B8%E3%81%8D',
    )
    expect(wikiSearchHref({ q: '設計' })).toBe('/wiki?q=%E8%A8%AD%E8%A8%88')
    expect(wikiSearchHref({ spaceKey: 'DOCS' })).toBe('/wiki/DOCS/search')
  })
})

describe('parseWikiSearchParams', () => {
  it('q は先頭の1つを使い、前後の空白を除いて最大長で切る', () => {
    expect(parseWikiSearchParams({ q: ['  設計  ', '無視'] }).keyword).toBe('設計')
    expect(parseWikiSearchParams({ q: 'a'.repeat(MAX_WIKI_SEARCH_KEYWORD + 10) }).keyword).toHaveLength(
      MAX_WIKI_SEARCH_KEYWORD,
    )
    expect(parseWikiSearchParams({})).toEqual({ keyword: '', tags: [] })
  })

  it('タグは空・長すぎるもの・重複を除き、上限の数までにする', () => {
    expect(parseWikiSearchParams({ tags: ' 仕様 ' }).tags).toEqual(['仕様'])
    expect(parseWikiSearchParams({ tags: ['仕様', '', '仕様', 'x'.repeat(21)] }).tags).toEqual(['仕様'])
    const many = Array.from({ length: MAX_WIKI_PAGE_TAGS + 3 }, (_, i) => `t${i}`)
    expect(parseWikiSearchParams({ tags: many }).tags).toHaveLength(MAX_WIKI_PAGE_TAGS)
  })
})

describe('pickExpiredWikiRevisionIds', () => {
  const EXPIRED = [
    { id: 'a3', pageId: 'a' },
    { id: 'b2', pageId: 'b' },
    { id: 'a2', pageId: 'a' },
    { id: 'b1', pageId: 'b' },
    { id: 'a1', pageId: 'a' },
  ]

  it('存在するページは最新の1版(基準版)だけを残す', () => {
    expect(pickExpiredWikiRevisionIds(EXPIRED, new Set(['a', 'b']))).toEqual(['a2', 'b1', 'a1'])
  })

  it('削除済みのページは期限より古い版をすべて消す', () => {
    expect(pickExpiredWikiRevisionIds(EXPIRED, new Set(['a']))).toEqual(['b2', 'a2', 'b1', 'a1'])
    expect(pickExpiredWikiRevisionIds(EXPIRED, new Set())).toEqual(EXPIRED.map(({ id }) => id))
  })

  it('期限より古い版が1つだけの存在ページは何も消さない', () => {
    expect(pickExpiredWikiRevisionIds([{ id: 'a1', pageId: 'a' }], new Set(['a']))).toEqual([])
  })
})
