/**
 * かんばんの並び替えと絞り込み(`board/kanban.ts`)の単体テスト
 *
 * prisma を型のみ参照する純粋関数なので、DB を起動せずに検証できる。
 */

import type { TicketStatus } from '@/generated/prisma/enums'
import {
  applyLaneMove,
  cardDropId,
  countLaneMap,
  defaultKanbanFilter,
  emptyLaneMap,
  filterLaneMap,
  groupByLane,
  insertAt,
  isKanbanFilterActive,
  KANBAN_DONE_DAYS_OPTIONS,
  KANBAN_DONE_VISIBLE_DAYS,
  kanbanDoneSince,
  kanbanLaneWhere,
  kanbanTicketWhere,
  laneDropId,
  matchesKanbanFilter,
  parseDropTarget,
  reindexLane,
  type KanbanFilterCard,
  type LaneMap,
} from '@/lib/board/kanban'
import { nextOrder } from '@/lib/board/tag-rule'
import { TICKET_STATUSES } from '@/lib/board/ticket-enum'
import { describe, expect, it } from 'vitest'

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

describe('nextOrder / reindexLane / insertAt', () => {
  it('空なら 0、既存があれば最大 + 1', () => {
    expect(nextOrder([])).toBe(0)
    expect(nextOrder([0, 1, 2])).toBe(3)
    expect(nextOrder([5, 1, 3]), '順不同でも最大値を見る').toBe(6)
  })

  it('欠番があっても最大値を基準にする', () => {
    expect(nextOrder([10]), '詰め直しはしない').toBe(11)
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
    expect(res?.from, '移動元のレーン').toBe('todo')
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
    expect(res?.from, '同一レーン内なら from と status は同じ').toBe(res?.status)
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

describe('kanbanDoneSince / kanbanTicketWhere / kanbanLaneWhere: かんばんの表示対象', () => {
  const now = new Date('2026-08-10T12:00:00.000Z')
  const since = kanbanDoneSince(now)
  // 完了日時なし(この機能の導入前に完了したチケット)も表示し続ける
  const doneVisible = { OR: [{ completedAt: null }, { completedAt: { gte: since } }] }

  it('表示期限は現在から KANBAN_DONE_VISIBLE_DAYS 日前', () => {
    expect(since.toISOString()).toBe('2026-07-11T12:00:00.000Z')
    expect(kanbanDoneSince(now, 1).toISOString(), '日数は上書きできる').toBe('2026-08-09T12:00:00.000Z')
  })

  it('ボード単位の where 断片は「完了以外 / 表示対象の完了」の OR になる', () => {
    expect(kanbanTicketWhere('b1', since)).toEqual({
      boardId: 'b1',
      OR: [{ status: { not: 'done' } }, doneVisible],
    })
  })

  it('done レーンの where 断片は表示期限で絞る', () => {
    expect(kanbanLaneWhere('b1', 'done', since)).toEqual({ boardId: 'b1', status: 'done', ...doneVisible })
  })

  it('done 以外のレーンの where 断片はボード + ステータスのみ', () => {
    for (const status of TICKET_STATUSES.filter((s) => s !== 'done')) {
      expect(kanbanLaneWhere('b1', status, since), status).toEqual({ boardId: 'b1', status })
    }
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

/* -------------------------------------------------------------------------------------------------
 * かんばんの絞り込み
 * -----------------------------------------------------------------------------------------------*/

const makeCard = (id: string, over: Partial<KanbanFilterCard> = {}): KanbanFilterCard => ({
  id,
  status: 'todo',
  assigneeId: null,
  priority: 'medium',
  tags: [],
  dueDate: null,
  completedAt: null,
  ...over,
})

/** 期日は UTC 0:00 で保存されるので、テストの値もその形で作る */
const due = (value: string) => new Date(`${value}T00:00:00.000Z`)

/** 完了カードの表示期間の判定に使う基準時刻。完了日時は時刻まで保持する */
const filterNow = new Date('2026-08-10T12:00:00.000Z')

describe('isKanbanFilterActive: 絞り込みが指定されているか', () => {
  it('初期値は非アクティブ', () => {
    expect(isKanbanFilterActive(defaultKanbanFilter)).toBe(false)
  })

  it('いずれか 1 つでも指定があればアクティブ', () => {
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, assignee: 'u1' })).toBe(true)
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, assignee: 'none' })).toBe(true)
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, priority: ['high'] })).toBe(true)
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, tags: ['bug'] })).toBe(true)
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, due: { start: '2026-08-01', end: '2026-08-31' } })).toBe(true)
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, doneDays: 7 })).toBe(true)
  })

  it('完了の表示期間が取得上限と同じならアクティブにしない', () => {
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, doneDays: KANBAN_DONE_VISIBLE_DAYS })).toBe(false)
  })
})

describe('KANBAN_DONE_DAYS_OPTIONS: 完了の表示期間の選択肢', () => {
  it('最大値は取得上限と一致する(サーバーがそれより古い done を返さない)', () => {
    expect(Math.max(...KANBAN_DONE_DAYS_OPTIONS)).toBe(KANBAN_DONE_VISIBLE_DAYS)
  })
})

describe('matchesKanbanFilter: カード 1 枚の一致判定', () => {
  it('条件なしはすべて通す', () => {
    expect(matchesKanbanFilter(makeCard('a', { assigneeId: 'u1' }), defaultKanbanFilter)).toBe(true)
  })

  it('担当者: 特定ユーザー', () => {
    const filter = { ...defaultKanbanFilter, assignee: 'u1' }
    expect(matchesKanbanFilter(makeCard('a', { assigneeId: 'u1' }), filter)).toBe(true)
    expect(matchesKanbanFilter(makeCard('b', { assigneeId: 'u2' }), filter)).toBe(false)
    expect(matchesKanbanFilter(makeCard('c', { assigneeId: null }), filter)).toBe(false)
  })

  it('担当者: 未割り当て(none)', () => {
    const filter = { ...defaultKanbanFilter, assignee: 'none' }
    expect(matchesKanbanFilter(makeCard('a', { assigneeId: null }), filter)).toBe(true)
    expect(matchesKanbanFilter(makeCard('b', { assigneeId: 'u1' }), filter)).toBe(false)
  })

  it('優先度: 空配列は無条件、非空は in 判定', () => {
    const card = makeCard('a', { priority: 'high' })
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, priority: [] })).toBe(true)
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, priority: ['urgent', 'high'] })).toBe(true)
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, priority: ['low'] })).toBe(false)
  })

  it('タグ: いずれか 1 つでも持てばヒット(OR)', () => {
    const card = makeCard('a', { tags: [{ name: 'bug' }, { name: 'ui' }] })
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, tags: ['ui'] })).toBe(true)
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, tags: ['ops', 'bug'] })).toBe(true)
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, tags: ['ops'] })).toBe(false)
    expect(matchesKanbanFilter(makeCard('b'), { ...defaultKanbanFilter, tags: ['bug'] })).toBe(false)
  })

  it('期日: 範囲内は両端を含む', () => {
    const filter = { ...defaultKanbanFilter, due: { start: '2026-08-10', end: '2026-08-20' } }
    expect(matchesKanbanFilter(makeCard('a', { dueDate: due('2026-08-15') }), filter)).toBe(true)
    expect(matchesKanbanFilter(makeCard('s', { dueDate: due('2026-08-10') }), filter), '開始と同日').toBe(true)
    expect(matchesKanbanFilter(makeCard('e', { dueDate: due('2026-08-20') }), filter), '終了と同日').toBe(true)
  })

  it('期日: 範囲外は落とす', () => {
    const filter = { ...defaultKanbanFilter, due: { start: '2026-08-10', end: '2026-08-20' } }
    expect(matchesKanbanFilter(makeCard('a', { dueDate: due('2026-08-09') }), filter)).toBe(false)
    expect(matchesKanbanFilter(makeCard('b', { dueDate: due('2026-08-21') }), filter)).toBe(false)
    // 年をまたいでも辞書順比較が崩れないこと
    expect(matchesKanbanFilter(makeCard('c', { dueDate: due('2025-12-31') }), filter)).toBe(false)
  })

  it('期日: 未設定はどの範囲にも入らない', () => {
    const filter = { ...defaultKanbanFilter, due: { start: '2026-08-10', end: '2026-08-20' } }
    expect(matchesKanbanFilter(makeCard('a', { dueDate: null }), filter)).toBe(false)
    // 範囲が未指定なら期日なしも通す
    expect(matchesKanbanFilter(makeCard('a', { dueDate: null }), defaultKanbanFilter)).toBe(true)
  })

  it('複数条件は AND', () => {
    const filter = {
      ...defaultKanbanFilter,
      assignee: 'u1',
      priority: ['high' as const],
      tags: ['bug'],
      due: { start: '2026-08-10', end: '2026-08-20' },
    }
    const base = { assigneeId: 'u1', priority: 'high' as const, tags: [{ name: 'bug' }], dueDate: due('2026-08-15') }
    expect(matchesKanbanFilter(makeCard('a', base), filter)).toBe(true)
    expect(matchesKanbanFilter(makeCard('b', { ...base, priority: 'low' }), filter)).toBe(false)
    expect(matchesKanbanFilter(makeCard('c', { ...base, dueDate: due('2026-09-01') }), filter)).toBe(false)
  })

  it('完了の表示期間: 期間内の完了は残り、期間外は落ちる', () => {
    const filter = { ...defaultKanbanFilter, doneDays: 7 }
    const done = (completedAt: Date) => makeCard('a', { status: 'done' as const, completedAt })
    expect(matchesKanbanFilter(done(new Date('2026-08-10T00:00:00.000Z')), filter, filterNow)).toBe(true)
    expect(matchesKanbanFilter(done(new Date('2026-08-03T12:00:00.000Z')), filter, filterNow), '境界と同時刻').toBe(
      true,
    )
    expect(matchesKanbanFilter(done(new Date('2026-08-03T11:59:59.000Z')), filter, filterNow)).toBe(false)
  })

  it('完了の表示期間: 完了日時なしの done は常に残す(サーバーの表示条件と揃える)', () => {
    const card = makeCard('a', { status: 'done', completedAt: null })
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, doneDays: 1 }, filterNow)).toBe(true)
  })

  it('完了の表示期間: done 以外は完了日時が古くても落ちない', () => {
    const card = makeCard('a', { status: 'todo', completedAt: new Date('2026-01-01T00:00:00.000Z') })
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, doneDays: 1 }, filterNow)).toBe(true)
  })
})

describe('filterLaneMap / countLaneMap: レーン単位の絞り込み', () => {
  const lanes = groupByLane([
    makeCard('t1', { status: 'todo', assigneeId: 'u1', priority: 'high', dueDate: due('2026-08-15') }),
    makeCard('t2', { status: 'todo', assigneeId: 'u2', priority: 'low', dueDate: due('2026-09-01') }),
    makeCard('d1', {
      status: 'doing',
      assigneeId: 'u1',
      priority: 'low',
      tags: [{ name: 'bug' }],
      dueDate: due('2026-08-20'),
    }),
    makeCard('b1', { status: 'backlog' }),
  ])

  it('条件なしは同一参照を返す(useMemo の無駄な再生成を避ける)', () => {
    expect(filterLaneMap(lanes, defaultKanbanFilter)).toBe(lanes)
  })

  it('レーンをまたいで絞り込まれ、4 レーンすべてが揃う', () => {
    const filtered = filterLaneMap(lanes, { ...defaultKanbanFilter, assignee: 'u1' })
    expect(Object.keys(filtered).sort()).toEqual([...TICKET_STATUSES].sort())
    expect(filtered.todo.map((c) => c.id)).toEqual(['t1'])
    expect(filtered.doing.map((c) => c.id)).toEqual(['d1'])
    expect(filtered.backlog).toEqual([])
    expect(countLaneMap(filtered)).toBe(2)
  })

  it('元の LaneMap は変更されない', () => {
    filterLaneMap(lanes, { ...defaultKanbanFilter, tags: ['bug'] })
    expect(countLaneMap(lanes)).toBe(4)
  })

  it('期日の範囲で絞ると、範囲外と期日なしが落ちる', () => {
    const filtered = filterLaneMap(lanes, { ...defaultKanbanFilter, due: { start: '2026-08-01', end: '2026-08-31' } })
    expect(filtered.todo.map((c) => c.id)).toEqual(['t1'])
    expect(filtered.doing.map((c) => c.id)).toEqual(['d1'])
    expect(filtered.backlog, '期日なしは除外').toEqual([])
    expect(countLaneMap(filtered)).toBe(2)
  })

  it('一致なしは全レーン空', () => {
    const filtered = filterLaneMap(lanes, { ...defaultKanbanFilter, tags: ['nope'] })
    expect(countLaneMap(filtered)).toBe(0)
  })

  it('完了の表示期間は done レーンだけを絞る', () => {
    const withDone = groupByLane([
      makeCard('t1', { status: 'todo' }),
      makeCard('recent', { status: 'done', completedAt: new Date('2026-08-09T00:00:00.000Z') }),
      makeCard('old', { status: 'done', completedAt: new Date('2026-07-20T00:00:00.000Z') }),
    ])
    const filtered = filterLaneMap(withDone, { ...defaultKanbanFilter, doneDays: 7 }, filterNow)
    expect(filtered.done.map((c) => c.id)).toEqual(['recent'])
    expect(
      filtered.todo.map((c) => c.id),
      '他のレーンは変わらない',
    ).toEqual(['t1'])
  })
})
