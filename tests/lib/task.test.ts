/**
 * タスク管理(チケット / ボード)のドメインロジックの単体テスト
 *
 * `src/lib/task.ts` は prisma を型のみ参照する純粋関数の集まりなので、
 * DB やネットワークを起動せずに検証できる(vitest の environment は node)。
 */

import type { TicketStatus } from '@/generated/prisma/enums'
import {
  applyLaneMove,
  buildTicketWhere,
  canApplyAssignments,
  cardDropId,
  emptyLaneMap,
  evaluateTicketAccess,
  extractMentionNames,
  groupByLane,
  insertAt,
  laneDropId,
  nextLaneOrder,
  normalizeMentionName,
  parseDropTarget,
  reindexLane,
  resolveBoardRole,
  resolveMentionUserIds,
  splitKeywords,
  stripCodeSpans,
  tagNamesWhere,
  TICKET_STATUSES,
  ticketScopeWhere,
  type BoardRole,
  type LaneMap,
  type TicketSearchParams,
} from '@/lib/task'
import { describe, expect, it } from 'vitest'

/* -------------------------------------------------------------------------------------------------
 * 権限
 * -----------------------------------------------------------------------------------------------*/

describe('resolveBoardRole: ボードの実効ロール解決', () => {
  const cases: { label: string; direct: BoardRole | null; group: boolean; expected: BoardRole | null }[] = [
    { label: '直接 owner', direct: 'owner', group: false, expected: 'owner' },
    { label: '直接 member', direct: 'member', group: false, expected: 'member' },
    { label: 'グループ経由のみ', direct: null, group: true, expected: 'member' },
    { label: 'どちらも無し', direct: null, group: false, expected: null },
    { label: '直接 member + グループ経由', direct: 'member', group: true, expected: 'member' },
    { label: '直接 owner + グループ経由(owner を維持)', direct: 'owner', group: true, expected: 'owner' },
  ]

  for (const { label, direct, group, expected } of cases) {
    it(label, () => {
      expect(resolveBoardRole(direct, group), `${label} は ${expected} になる`).toBe(expected)
    })
  }
})

describe('evaluateTicketAccess: ボードのロールから権限を決める', () => {
  // プライベートチケットもプライベートボード(本人が owner)に属するため、
  // 「本人のみ全操作可」は boardRole='owner' のケースでそのまま担保される
  it('owner は削除まで可能', () => {
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u9', boardRole: 'owner' })
    expect(res).toEqual({ canView: true, canEdit: true, canDelete: true })
  })

  it('プライベートボード相当(自分が owner かつ作成者)は全操作可', () => {
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u1', boardRole: 'owner' })
    expect(res, 'プライベートチケットの従来挙動と一致する').toEqual({
      canView: true,
      canEdit: true,
      canDelete: true,
    })
  })

  it('member かつ作成者なら削除可能', () => {
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u1', boardRole: 'member' })
    expect(res.canDelete, '自分が作成したチケットは削除できる').toBe(true)
  })

  it('member かつ非作成者は削除不可(閲覧・編集は可能)', () => {
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u9', boardRole: 'member' })
    expect(res).toEqual({ canView: true, canEdit: true, canDelete: false })
  })

  it('非メンバー(boardRole=null)は作成者でも一切不可', () => {
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u1', boardRole: null })
    expect(res).toEqual({ canView: false, canEdit: false, canDelete: false })
  })
})

describe('canApplyAssignments: ボードのアサイン', () => {
  it('owner が 0 人になるアサインは owner 自身には許可しない', () => {
    expect(canApplyAssignments({ ownerIds: [], byAdmin: false }), 'owner 操作では拒否').toBe(false)
    expect(canApplyAssignments({ ownerIds: [], byAdmin: true }), '管理者操作では許可').toBe(true)
    expect(canApplyAssignments({ ownerIds: ['u1'], byAdmin: false }), 'owner が 1 人以上なら許可').toBe(true)
  })
})

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
    assignee: 'any',
  }
  const ctx = { userId: 'u1', accessibleBoardIds: ['b1', 'b2'] }

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

  it('assignee=me は自分、assignee=none は未割り当てに絞る', () => {
    expect(buildTicketWhere({ ...emptyParams, assignee: 'me' }, ctx).AND as object[]).toContainEqual({
      assigneeId: 'u1',
    })
    expect(buildTicketWhere({ ...emptyParams, assignee: 'none' }, ctx).AND as object[]).toContainEqual({
      assigneeId: null,
    })
  })

  it('assignee=any では担当者の条件を付けない', () => {
    const res = buildTicketWhere(emptyParams, ctx)
    expect(res.AND).toHaveLength(1)
  })
})

/* -------------------------------------------------------------------------------------------------
 * メンション
 * -----------------------------------------------------------------------------------------------*/

describe('stripCodeSpans / normalizeMentionName', () => {
  it('コードブロックとインラインコードを除去する', () => {
    expect(stripCodeSpans('a ```x``` b `y` c').includes('x')).toBe(false)
    expect(stripCodeSpans('a ```x``` b `y` c').includes('y')).toBe(false)
  })

  it('全角・大文字小文字・前後空白を正規化する', () => {
    expect(normalizeMentionName(' ＴＡＲＯ ')).toBe('taro')
    expect(normalizeMentionName('Taro')).toBe('taro')
  })
})

describe('extractMentionNames: 本文からメンションを抽出する', () => {
  const cases: { label: string; input: string; expected: string[] }[] = [
    { label: '行頭のメンション', input: '@太郎', expected: ['太郎'] },
    { label: '文中のメンション', input: 'よろしく @太郎 です', expected: ['太郎'] },
    { label: '連続したメンションを出現順に抽出する', input: '@alice @bob', expected: ['alice', 'bob'] },
    { label: '2 行目の行頭', input: '一行目\n@太郎', expected: ['太郎'] },
    { label: '角括弧で空白入りの名前を指定できる', input: '@[山田 太郎] お願いします', expected: ['山田 太郎'] },
    { label: '読点で終端する', input: '@太郎、次に', expected: ['太郎'] },
    { label: '句点で終端する', input: '@太郎。', expected: ['太郎'] },
    { label: '閉じ括弧で終端する', input: '(@太郎)', expected: ['太郎'] },
    { label: 'ピリオドで終端する', input: 'thanks @taro.', expected: ['taro'] },
    { label: '重複は 1 件に畳む', input: '@太郎 と @太郎', expected: ['太郎'] },
    { label: '大文字小文字の差異も重複扱い', input: '@Taro @taro', expected: ['Taro'] },
    { label: 'メールアドレスは誤検知しない', input: 'foo@example.com へ連絡', expected: [] },
    { label: '@ が連続する場合は無視する', input: '@@太郎', expected: [] },
    { label: 'コードブロック内は対象外', input: '```\n@太郎\n```', expected: [] },
    { label: 'インラインコード内は対象外', input: '`@太郎`', expected: [] },
    { label: '@ 単体は 0 件', input: '@', expected: [] },
    { label: '空文字は 0 件', input: '', expected: [] },
    { label: '最大長(60文字)は抽出する', input: `@${'a'.repeat(60)}`, expected: ['a'.repeat(60)] },
    { label: '最大長超過(61文字)は抽出しない', input: `@${'a'.repeat(61)}`, expected: [] },
  ]

  for (const { label, input, expected } of cases) {
    it(label, () => {
      expect(extractMentionNames(input), `入力: ${JSON.stringify(input)}`).toEqual(expected)
    })
  }
})

describe('resolveMentionUserIds: 表示名を userId へ解決する', () => {
  const candidates = [
    { id: 'u1', name: 'taro' },
    { id: 'u2', name: 'hanako' },
  ]

  it('候補に一致すれば解決する', () => {
    expect(resolveMentionUserIds(['taro'], candidates)).toEqual(['u1'])
  })

  it('候補に無い名前は解決しない', () => {
    expect(resolveMentionUserIds(['jiro'], candidates)).toEqual([])
  })

  it('同名の候補が 2 人いる場合は誤通知を避けるため解決しない', () => {
    const dup = [
      { id: 'u1', name: 'taro' },
      { id: 'u3', name: 'taro' },
    ]
    expect(resolveMentionUserIds(['taro'], dup), '曖昧なメンションは通知しない').toEqual([])
  })

  it('全角・大文字小文字の差異を吸収して一致する', () => {
    expect(resolveMentionUserIds(['ＴＡＲＯ'], candidates)).toEqual(['u1'])
    expect(resolveMentionUserIds(['Taro'], candidates)).toEqual(['u1'])
  })

  it('候補が空なら 0 件', () => {
    expect(resolveMentionUserIds(['taro'], [])).toEqual([])
  })

  it('抽出順を保ち、同一 userId は 1 回だけ返す', () => {
    expect(resolveMentionUserIds(['hanako', 'taro', 'ＨＡＮＡＫＯ'], candidates)).toEqual(['u2', 'u1'])
  })

  it('同じ ID が候補に重複していても解決できる', () => {
    const dupRow = [
      { id: 'u1', name: 'taro' },
      { id: 'u1', name: 'taro' },
    ]
    expect(resolveMentionUserIds(['taro'], dupRow), '同一 ID の重複は同名衝突ではない').toEqual(['u1'])
  })
})

/* -------------------------------------------------------------------------------------------------
 * かんばんの並び替え
 * -----------------------------------------------------------------------------------------------*/

describe('parseDropTarget / laneDropId / cardDropId', () => {
  it('レーンの id をパースできる', () => {
    expect(parseDropTarget(laneDropId('doing'))).toEqual({ kind: 'lane', status: 'doing' })
  })

  it('カードの id をパースできる', () => {
    expect(parseDropTarget(cardDropId('t1'))).toEqual({ kind: 'card', ticketId: 't1' })
  })

  it('未知のステータス・形式は null', () => {
    expect(parseDropTarget('lane:unknown'), '存在しないステータス').toBeNull()
    expect(parseDropTarget('other:x'), '未知の種別').toBeNull()
    expect(parseDropTarget('lane:'), '値が空').toBeNull()
    expect(parseDropTarget('doing'), '区切りが無い').toBeNull()
  })
})

describe('nextLaneOrder / reindexLane / insertAt', () => {
  it('空レーンの order は 0、既存があれば最大 + 1', () => {
    expect(nextLaneOrder([])).toBe(0)
    expect(nextLaneOrder([0, 1, 2])).toBe(3)
    expect(nextLaneOrder([5, 1, 3]), '順不同でも最大値を見る').toBe(6)
  })

  it('reindexLane は 0 始まりの連番へ再採番する', () => {
    expect(reindexLane(['a', 'b', 'c'])).toEqual([
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
      { id: 'c', order: 2 },
    ])
  })

  it('insertAt は指定位置へ挿入し、範囲外はクランプする', () => {
    expect(insertAt(['a', 'c'], 'b', 1)).toEqual(['a', 'b', 'c'])
    expect(insertAt(['a', 'b'], 'x', 0)).toEqual(['x', 'a', 'b'])
    expect(insertAt(['a', 'b'], 'x', 99), '上限はクランプ').toEqual(['a', 'b', 'x'])
    expect(insertAt(['a', 'b'], 'x', -5), '下限はクランプ').toEqual(['x', 'a', 'b'])
  })
})

describe('applyLaneMove: DnD 結果をレーンへ適用する', () => {
  const makeLanes = (init: Partial<Record<TicketStatus, string[]>>): LaneMap => {
    const lanes = {} as LaneMap
    for (const status of TICKET_STATUSES) {
      lanes[status] = (init[status] ?? []).map((id) => ({ id, status }))
    }
    return lanes
  }
  const ids = (cards: { id: string }[]) => cards.map((c) => c.id)

  it('レーン間の移動はドロップ先の末尾へ入る', () => {
    const lanes = makeLanes({ todo: ['t1', 't2'], doing: ['d1'] })
    const res = applyLaneMove(lanes, { ticketId: 't1', target: { kind: 'lane', status: 'doing' } })
    expect(res).not.toBeNull()
    expect(res?.status).toBe('doing')
    expect(res?.index, '末尾の位置').toBe(1)
    expect(ids(res!.lanes.doing)).toEqual(['d1', 't1'])
    expect(ids(res!.lanes.todo), '移動元から除かれる').toEqual(['t2'])
    expect(res!.lanes.doing[1].status, 'カードの status も更新される').toBe('doing')
  })

  it('元の LaneMap を破壊しない', () => {
    const lanes = makeLanes({ todo: ['t1'], doing: [] })
    applyLaneMove(lanes, { ticketId: 't1', target: { kind: 'lane', status: 'doing' } })
    expect(ids(lanes.todo), '引数はそのまま').toEqual(['t1'])
    expect(ids(lanes.doing)).toEqual([])
  })

  it('空レーンへ移動できる', () => {
    const lanes = makeLanes({ todo: ['t1'], backlog: [] })
    const res = applyLaneMove(lanes, { ticketId: 't1', target: { kind: 'lane', status: 'backlog' } })
    expect(res?.index).toBe(0)
    expect(ids(res!.lanes.backlog)).toEqual(['t1'])
  })

  it('backlog から todo へも移動できる', () => {
    const lanes = makeLanes({ backlog: ['b1'], todo: ['t1'] })
    const res = applyLaneMove(lanes, { ticketId: 'b1', target: { kind: 'lane', status: 'todo' } })
    expect(ids(res!.lanes.todo)).toEqual(['t1', 'b1'])
    expect(ids(res!.lanes.backlog)).toEqual([])
  })

  it('同一レーン内でカードの直前へ移動する(上へ)', () => {
    const lanes = makeLanes({ todo: ['a', 'b', 'c'] })
    const res = applyLaneMove(lanes, { ticketId: 'c', target: { kind: 'card', ticketId: 'a' } })
    expect(ids(res!.lanes.todo)).toEqual(['c', 'a', 'b'])
    expect(res?.index).toBe(0)
  })

  it('同一レーン内で下へ移動する', () => {
    const lanes = makeLanes({ todo: ['a', 'b', 'c'] })
    const res = applyLaneMove(lanes, { ticketId: 'a', target: { kind: 'card', ticketId: 'c' } })
    expect(ids(res!.lanes.todo)).toEqual(['b', 'a', 'c'])
  })

  it('同一レーン内でレーンへドロップすると末尾へ移動する', () => {
    const lanes = makeLanes({ todo: ['a', 'b', 'c'] })
    const res = applyLaneMove(lanes, { ticketId: 'a', target: { kind: 'lane', status: 'todo' } })
    expect(ids(res!.lanes.todo)).toEqual(['b', 'c', 'a'])
    expect(res?.index).toBe(2)
  })

  it('位置が変わらない移動は null(更新を投げない)', () => {
    const lanes = makeLanes({ todo: ['a', 'b', 'c'] })
    expect(
      applyLaneMove(lanes, { ticketId: 'a', target: { kind: 'card', ticketId: 'b' } }),
      '直後のカードへのドロップは同じ位置',
    ).toBeNull()
    expect(
      applyLaneMove(lanes, { ticketId: 'c', target: { kind: 'lane', status: 'todo' } }),
      '既に末尾のカードをレーンへドロップ',
    ).toBeNull()
  })

  it('自分自身へのドロップは null', () => {
    const lanes = makeLanes({ todo: ['a'] })
    expect(applyLaneMove(lanes, { ticketId: 'a', target: { kind: 'card', ticketId: 'a' } })).toBeNull()
  })

  it('存在しないチケットは null', () => {
    const lanes = makeLanes({ todo: ['a'] })
    expect(applyLaneMove(lanes, { ticketId: 'zzz', target: { kind: 'lane', status: 'doing' } })).toBeNull()
  })

  it('存在しないドロップ先カードは null', () => {
    const lanes = makeLanes({ todo: ['a'] })
    expect(applyLaneMove(lanes, { ticketId: 'a', target: { kind: 'card', ticketId: 'zzz' } })).toBeNull()
  })
})

describe('emptyLaneMap / groupByLane: カードのレーン振り分け', () => {
  it('空配列は 4 レーンすべて空の LaneMap になる', () => {
    const lanes = groupByLane([])
    expect(Object.keys(lanes).sort()).toEqual([...TICKET_STATUSES].sort())
    for (const status of TICKET_STATUSES) {
      expect(lanes[status], status).toEqual([])
    }
  })

  it('status 別に振り分け、入力順(order 順)を保つ', () => {
    const cards = [
      { id: 't1', status: 'todo' as const },
      { id: 'd1', status: 'doing' as const },
      { id: 't2', status: 'todo' as const },
      { id: 'b1', status: 'backlog' as const },
    ]
    const lanes = groupByLane(cards)
    expect(
      lanes.todo.map((c) => c.id),
      '入力順を保持',
    ).toEqual(['t1', 't2'])
    expect(lanes.doing.map((c) => c.id)).toEqual(['d1'])
    expect(lanes.backlog.map((c) => c.id)).toEqual(['b1'])
    expect(lanes.done).toEqual([])
  })

  it('emptyLaneMap は呼び出しごとに独立した配列を返す', () => {
    const a = emptyLaneMap()
    const b = emptyLaneMap()
    a.todo.push({ id: 'x', status: 'todo' })
    expect(b.todo, '参照が共有されていない').toEqual([])
  })
})
