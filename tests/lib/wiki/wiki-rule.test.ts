/**
 * Wiki の純粋関数(wiki-rule.ts)
 *
 * ロールの解決と権限の評価、版をまとめるかの判定、ページ指定の解析を確かめる。
 */

import {
  canDeleteWikiRevision,
  defaultWikiPageType,
  evaluateWikiAccess,
  hasWikiRole,
  isFlatWikiSpace,
  isWikiPageTypeAllowed,
  MAX_WIKI_PAGE_TAGS,
  MAX_WIKI_SEARCH_KEYWORD,
  parseWikiPageRef,
  parseWikiSearchParams,
  resolveWikiRevisionTags,
  resolveWikiRole,
  revisionTagColumns,
  revisionTagsOf,
  shouldMergeWikiRevision,
  strongestWikiRole,
  wikiPageRef,
  wikiRevisionTagLabels,
  wikiSearchHref,
  type WikiRevisionOrigin,
  type WikiRole,
} from '@/lib/wiki/wiki-rule'
import { describe, expect, it } from 'vitest'

describe('区分ごとのページの種類', () => {
  it.each([
    ['mixed', 'page', true],
    ['mixed', 'design_doc', true],
    ['design_doc', 'page', false],
    ['design_doc', 'design_doc', true],
    ['announcement', 'page', true],
    ['announcement', 'design_doc', false],
  ] as const)('%s スペースに %s を作れるか: %s', (spaceType, pageType, expected) => {
    expect(isWikiPageTypeAllowed(spaceType, pageType)).toBe(expected)
  })

  it('種類を省いたときの既定と、平らな区分', () => {
    expect(defaultWikiPageType('mixed')).toBe('page')
    expect(defaultWikiPageType('design_doc')).toBe('design_doc')
    expect(defaultWikiPageType('announcement')).toBe('page')
    expect(isFlatWikiSpace('announcement')).toBe(true)
    expect(isFlatWikiSpace('mixed')).toBe(false)
    expect(isFlatWikiSpace('design_doc')).toBe(false)
  })
})

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

describe('canDeleteWikiRevision', () => {
  const access = (role: WikiRole | null, archived: boolean, isAdmin: boolean) => ({
    ...evaluateWikiAccess({ role, archived, isAdmin }),
    archived,
  })

  it.each([
    ['viewer', false, false, false],
    // 編集者は版を書けても消せない(本文を空にしてから前の版を消せば、内容を戻せなくなるため)
    ['editor', false, false, false],
    ['owner', false, false, true],
    ['owner', true, false, false],
    ['viewer', false, true, true],
    // 本文を読めない管理者は消せない
    [null, false, true, false],
  ] as const)('role=%s archived=%s admin=%s', (role, archived, isAdmin, expected) => {
    expect(canDeleteWikiRevision(access(role, archived, isAdmin))).toBe(expected)
  })
})

describe('shouldMergeWikiRevision', () => {
  const NOW = new Date('2026-11-08T10:00:00.000Z')
  const origin: WikiRevisionOrigin = {
    action: 'updated',
    actorId: 'u1',
    via: 'web',
    ticketId: null,
    message: null,
  }
  /** 保持期限(保持 7 日)。これより前に最後に保存した版は、掃除が基準版として残す */
  const CUTOFF = new Date('2026-11-01T10:00:00.000Z')
  const latest = (override: Partial<WikiRevisionOrigin & { createdAt: Date; updatedAt: Date }> = {}) => ({
    ...origin,
    createdAt: new Date('2026-11-08T09:55:00.000Z'),
    updatedAt: new Date('2026-11-08T09:58:00.000Z'),
    ...override,
  })
  const merge = (mergeMinutes: number, retentionCutoff: Date = CUTOFF) => ({ mergeMinutes, retentionCutoff })

  it('同じ人・経路・チケットの updated が時間内に続けばまとめる', () => {
    expect(shouldMergeWikiRevision(latest(), origin, NOW, merge(10))).toBe(true)
  })

  it('最新の版の作成からちょうど上限の時間まではまとめる', () => {
    expect(
      shouldMergeWikiRevision(latest({ createdAt: new Date('2026-11-08T09:50:00.000Z') }), origin, NOW, merge(10)),
    ).toBe(true)
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
    ['今回にコミットメッセージがある', latest(), { ...origin, message: '誤字の修正' }, 10],
    ['最新の版にコミットメッセージがある', latest({ message: '誤字の修正' }), origin, 10],
  ] as const)('%s ならまとめない', (_, last, next, minutes) => {
    expect(shouldMergeWikiRevision(last, next, NOW, merge(minutes))).toBe(false)
  })

  describe('まとめる時間が保持期間より長い(14 日分)', () => {
    const LONG = 14 * 24 * 60

    it('最新の版の最後の保存が保持期限より前ならまとめない(保持期間より前の基準版を上書きしない)', () => {
      const old = new Date('2026-10-30T10:00:00.000Z')
      expect(shouldMergeWikiRevision(latest({ createdAt: old, updatedAt: old }), origin, NOW, merge(LONG))).toBe(false)
    })

    it('最新の版の最後の保存がちょうど保持期限ならまとめる', () => {
      expect(
        shouldMergeWikiRevision(
          latest({ createdAt: new Date('2026-10-30T10:00:00.000Z'), updatedAt: CUTOFF }),
          origin,
          NOW,
          merge(LONG),
        ),
      ).toBe(true)
    })
  })
})

describe('版のタグ', () => {
  // t1 は版の後で「旧A」から「A」に改名、t9 は削除済みで、同じ名前の t3 を作り直している
  const revisionTags = [
    { id: 't2', name: 'B' },
    { id: 't9', name: '消えた' },
    { id: 't1', name: '旧A' },
  ]
  const spaceTags = [
    { id: 't1', name: 'A' },
    { id: 't2', name: 'B' },
    { id: 't3', name: '消えた' },
  ]

  it('DB の列(同じ並びの ID と名前)と行き来できる', () => {
    const columns = revisionTagColumns(revisionTags)
    expect(columns).toEqual({ tagIds: ['t2', 't9', 't1'], tagNames: ['B', '消えた', '旧A'] })
    expect(revisionTagsOf(columns)).toEqual(revisionTags)
  })

  it('resolveWikiRevisionTags: ID でスペースのタグに引き当て、改名後の名前・スペースの表示順で返す。削除したタグは同じ名前があっても出さない', () => {
    expect(resolveWikiRevisionTags(revisionTags, spaceTags)).toEqual([spaceTags[0], spaceTags[1]])
  })

  it('wikiRevisionTagLabels: 残っているタグは今の名前、削除したタグは版の名前に印を付ける(同じ名前で作り直したタグと区別する)', () => {
    expect(wikiRevisionTagLabels(revisionTags, spaceTags, (name) => `${name}(削除済み)`)).toEqual([
      'B',
      '消えた(削除済み)',
      'A',
    ])
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
