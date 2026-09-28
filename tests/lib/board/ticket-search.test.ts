/**
 * チケット検索の条件組み立て(`board/ticket-search.ts`)の単体テスト
 *
 * prisma を型のみ参照する純粋関数なので、DB を起動せずに検証できる。
 */

import {
  ASSIGNEE_NONE,
  buildTicketWhere,
  relationWhere,
  splitKeywords,
  tagNamesWhere,
  TICKET_SORT_COLUMNS,
  ticketCandidateWhere,
  ticketIdOrTitleWhere,
  ticketListOrderBy,
  ticketScopeWhere,
  type TicketSearchParams,
} from '@/lib/board/ticket-search'
import { describe, expect, it } from 'vitest'

/* -------------------------------------------------------------------------------------------------
 * 検索
 * -----------------------------------------------------------------------------------------------*/

describe('splitKeywords: キーワードの分解', () => {
  it('空白区切りで分解する', () => {
    expect(splitKeywords('foo bar')).toEqual(['foo', 'bar'])
  })

  it('LIKE のワイルドカード(% _ \\)を除去する', () => {
    expect(splitKeywords('fo%o b_ar\\baz'), 'ワイルドカードは区切りとして扱われる').toEqual([
      'fo',
      'o',
      'b',
      'ar',
      'baz',
    ])
  })

  it('連続空白・前後の空白を無視する', () => {
    expect(splitKeywords('  foo   bar  ')).toEqual(['foo', 'bar'])
  })

  it('全角空白も区切りとして扱う', () => {
    expect(splitKeywords('検索　条件')).toEqual(['検索', '条件'])
  })

  it('上限を超えた語は切り捨てる(既定 5 語)', () => {
    expect(splitKeywords('a b c d e f g')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('空文字は 0 件', () => {
    expect(splitKeywords('')).toEqual([])
    expect(splitKeywords('   ')).toEqual([])
  })
})

describe('ticketScopeWhere: 可視スコープの where 断片', () => {
  it('可視ボードの in 条件になる(プライベートボードも含まれる)', () => {
    expect(ticketScopeWhere(['b1', 'b2'])).toEqual({ boardId: { in: ['b1', 'b2'] } })
  })

  it('可視ボードが無ければ 0 件になる', () => {
    // 旧実装は boardId=null の OR があったため空でも自分のチケットが見えたが、
    // 現在はプライベートボードが accessibleBoardIds に含まれていることが前提
    expect(ticketScopeWhere([]), 'ensurePrivateBoard を先に通していないと 0 件になる').toEqual({
      boardId: { in: [] },
    })
  })
})

describe('buildTicketWhere: 検索条件から Prisma where を組む', () => {
  const emptyParams: TicketSearchParams = {
    keyword: '',
    status: [],
    priority: [],
    tags: [],
    boardId: null,
    assignee: null,
  }
  const ctx = { accessibleBoardIds: ['b1', 'b2'] }

  it('条件なしなら可視スコープのみ', () => {
    const res = buildTicketWhere(emptyParams, ctx)
    expect(res.AND, '可視スコープの 1 条件だけになる').toHaveLength(1)
    expect((res.AND as object[])[0]).toEqual(ticketScopeWhere(['b1', 'b2']))
  })

  it('boardId 未指定なら可視ボード全体に限定する', () => {
    const res = buildTicketWhere(emptyParams, ctx)
    expect((res.AND as object[])[0]).toEqual({ boardId: { in: ['b1', 'b2'] } })
  })

  it('boardId 指定は可視ボードとの交差を取る', () => {
    const res = buildTicketWhere({ ...emptyParams, boardId: 'b1' }, ctx)
    expect((res.AND as object[])[0]).toEqual({ boardId: { in: ['b1'] } })
  })

  it('可視外の boardId を指定しても他ボードは見えない(0 件になる)', () => {
    const res = buildTicketWhere({ ...emptyParams, boardId: 'other' }, ctx)
    expect((res.AND as object[])[0], '交差が空になるため 0 件').toEqual({ boardId: { in: [] } })
  })

  it('キーワードは語ごとに AND 条件が増える', () => {
    const one = buildTicketWhere({ ...emptyParams, keyword: 'foo' }, ctx)
    const two = buildTicketWhere({ ...emptyParams, keyword: 'foo bar' }, ctx)
    expect(one.AND, 'スコープ + 1 語').toHaveLength(2)
    expect(two.AND, 'スコープ + 2 語').toHaveLength(3)
  })

  it('1 語はタイトル / 本文 / タグ / コメントを横断 OR する', () => {
    const res = buildTicketWhere({ ...emptyParams, keyword: 'foo' }, ctx)
    expect((res.AND as { OR?: unknown[] }[])[1]).toEqual({
      OR: [
        { title: { contains: 'foo', mode: 'insensitive' } },
        { content: { contains: 'foo', mode: 'insensitive' } },
        { tags: { some: { tag: { name: { equals: 'foo', mode: 'insensitive' } } } } },
        { comments: { some: { content: { contains: 'foo', mode: 'insensitive' } } } },
      ],
    })
  })

  it('表示IDを貼るとキー + 番号の完全一致が OR の先頭に足される', () => {
    const res = buildTicketWhere({ ...emptyParams, keyword: 'DEV-12' }, ctx)
    const or = (res.AND as { OR: unknown[] }[])[1].OR
    expect(or[0], '索引が効く完全一致を先に評価させる').toEqual({ number: 12, board: { key: 'DEV' } })
    expect(or, '文字列としての横断検索も残る').toHaveLength(5)
  })

  it('番号だけの指定はボードを跨いで番号一致する', () => {
    const res = buildTicketWhere({ ...emptyParams, keyword: '#12' }, ctx)
    expect((res.AND as { OR: unknown[] }[])[1].OR[0]).toEqual({ number: 12 })
  })

  it('status / priority / タグはいずれも in(= OR)になる', () => {
    const res = buildTicketWhere(
      { ...emptyParams, status: ['todo', 'doing'], priority: ['high'], tags: ['bug', 'ui'] },
      ctx,
    )
    const and = res.AND as object[]
    expect(and).toContainEqual({ status: { in: ['todo', 'doing'] } })
    expect(and).toContainEqual({ priority: { in: ['high'] } })
    // 退行防止: タグは 1 つの some に name: { in: [...] } でまとめること。
    // 名前ごとに some を分けて AND すると「すべてのタグを持つ」条件になってしまう
    expect(and, 'いずれかのタグを持てばヒットする EXISTS 条件').toContainEqual(tagNamesWhere(['bug', 'ui']))
    expect(and, 'スコープ + status + priority + タグ 1 条件').toHaveLength(4)
  })

  it('同名タグの重複指定は 1 件に畳まれる', () => {
    const res = buildTicketWhere({ ...emptyParams, tags: ['bug', 'bug', ' bug '] }, ctx)
    expect(res.AND, 'スコープ + タグ 1 条件').toHaveLength(2)
    expect((res.AND as object[])[1]).toEqual(tagNamesWhere(['bug']))
  })

  it('tags が空ならタグ条件を付けない', () => {
    const res = buildTicketWhere({ ...emptyParams, tags: [] }, ctx)
    expect(res.AND).toHaveLength(1)
  })

  it('assignee は userId 指定、ASSIGNEE_NONE は未割り当てに絞る', () => {
    expect(buildTicketWhere({ ...emptyParams, assignee: 'u1' }, ctx).AND as object[]).toContainEqual({
      assigneeId: 'u1',
    })
    expect(buildTicketWhere({ ...emptyParams, assignee: ASSIGNEE_NONE }, ctx).AND as object[]).toContainEqual({
      assigneeId: null,
    })
  })

  it('assignee 未指定(すべて)では担当者の条件を付けない', () => {
    expect(buildTicketWhere(emptyParams, ctx).AND).toHaveLength(1)
    expect(buildTicketWhere({ ...emptyParams, assignee: undefined }, ctx).AND).toHaveLength(1)
  })

  it('relatedTo を指定すると関係の条件を付け、空文字なら付けない', () => {
    expect(buildTicketWhere({ ...emptyParams, relatedTo: 'ABC-1', relation: 'child' }, ctx).AND).toContainEqual(
      relationWhere('ABC-1', 'child'),
    )
    expect(buildTicketWhere({ ...emptyParams, relatedTo: '' }, ctx).AND).toHaveLength(1)
  })

  it('relation 未指定は子と関連の両方で絞る', () => {
    expect(buildTicketWhere({ ...emptyParams, relatedTo: 'ABC-1' }, ctx).AND).toContainEqual(
      relationWhere('ABC-1', 'all'),
    )
  })
})

describe('ticketIdOrTitleWhere: 表示ID / 番号 / 件名の条件', () => {
  it('表示IDはキーと番号、件名は部分一致で OR にする', () => {
    expect(ticketIdOrTitleWhere('abc-12')).toEqual({
      OR: [{ number: 12, board: { key: 'ABC' } }, { title: { contains: 'abc-12', mode: 'insensitive' } }],
    })
  })

  it('番号だけなら番号で引き、本文やコメントは見ない', () => {
    expect(ticketIdOrTitleWhere('#7')).toEqual({
      OR: [{ number: 7 }, { title: { contains: '#7', mode: 'insensitive' } }],
    })
    expect(JSON.stringify(ticketIdOrTitleWhere('foo'))).not.toMatch(/content|comments/)
  })
})

describe('ticketCandidateWhere: チケットの候補の条件', () => {
  it('キーワードが空なら完了以外に絞る', () => {
    expect(ticketCandidateWhere('')).toEqual([{ status: { not: 'done' } }])
    expect(ticketCandidateWhere('   ')).toEqual([{ status: { not: 'done' } }])
  })

  it('キーワードがあれば語ごとの表示ID / 件名の条件にし、完了も含める', () => {
    expect(ticketCandidateWhere('abc-12 foo')).toEqual([ticketIdOrTitleWhere('abc-12'), ticketIdOrTitleWhere('foo')])
  })
})

describe('relationWhere: 関係するチケットの条件', () => {
  const target = { number: 1, board: { key: 'ABC' } }

  it('child は指定したチケットを親に持つもの', () => {
    expect(relationWhere('abc-1', 'child')).toEqual({ relationsTo: { some: { type: 'parent', from: target } } })
  })

  it('related は向きを問わず関連付いたもの', () => {
    expect(relationWhere('ABC-1', 'related')).toEqual({
      OR: [
        { relationsFrom: { some: { type: 'related', to: target } } },
        { relationsTo: { some: { type: 'related', from: target } } },
      ],
    })
  })

  it('all は子と関連の OR', () => {
    expect(relationWhere('ABC-1', 'all')).toEqual({
      OR: [relationWhere('ABC-1', 'child'), relationWhere('ABC-1', 'related')],
    })
  })

  it('表示IDとして読めない値は 0 件にする', () => {
    expect(relationWhere('12', 'all')).toEqual({ id: { in: [] } })
  })
})

describe('ticketListOrderBy: 一覧の並び順から Prisma orderBy を組む', () => {
  it('ascending / descending を asc / desc に変換する', () => {
    expect(ticketListOrderBy('title', 'ascending')).toEqual([{ title: 'asc' }, { id: 'asc' }])
    expect(ticketListOrderBy('title', 'descending')).toEqual([{ title: 'desc' }, { id: 'desc' }])
  })

  it('どの列でも最後のタイブレークに id が入る(ページ間で行が重複・欠落しないため)', () => {
    for (const column of TICKET_SORT_COLUMNS) {
      const orderBy = ticketListOrderBy(column, 'descending')
      expect(orderBy, `${column} は 2 条件になる`).toHaveLength(2)
      expect(orderBy[1], `${column} の末尾は id`).toEqual({ id: 'desc' })
    }
  })

  it('status / priority はスカラー列としてそのまま並べる(enum の宣言順で並ぶ)', () => {
    expect(ticketListOrderBy('status', 'ascending')[0]).toEqual({ status: 'asc' })
    expect(ticketListOrderBy('priority', 'ascending')[0]).toEqual({ priority: 'asc' })
  })

  it('assigneeName はリレーション先の name で並べる', () => {
    expect(ticketListOrderBy('assigneeName', 'ascending')[0]).toEqual({ assignee: { name: 'asc' } })
  })

  it('dueDate は昇順・降順とも未設定を末尾に寄せる', () => {
    expect(ticketListOrderBy('dueDate', 'ascending')[0]).toEqual({ dueDate: { sort: 'asc', nulls: 'last' } })
    expect(ticketListOrderBy('dueDate', 'descending')[0]).toEqual({ dueDate: { sort: 'desc', nulls: 'last' } })
  })
})
