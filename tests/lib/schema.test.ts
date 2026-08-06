/**
 * Zod スキーマの単体テスト
 *
 * 既定値・必須の境界だけを対象にする(項目ごとの文字数制限は UI の constraintSchema が担う)。
 */

import { scCreateTicket, scMoveTicket, scPatchTicket, scTicketSearch } from '@/lib/schema'
import { ASSIGNEE_NONE } from '@/lib/task'
import { describe, expect, it } from 'vitest'

const boardId = '01920000-0000-7000-8000-000000000001'
const ticketId = '01920000-0000-7000-8000-000000000002'
const userId = '01920000-0000-7000-8000-000000000003'

describe('scCreateTicket: priority は必須(既定 medium)', () => {
  it('priority 未指定なら medium になる', () => {
    const res = scCreateTicket.parse({ boardId, title: 'タイトル' })
    expect(res.priority).toBe('medium')
    expect(res.status, 'status の既定は todo').toBe('todo')
  })

  it('明示指定した優先度はそのまま通る', () => {
    expect(scCreateTicket.parse({ boardId, title: 'x', priority: 'urgent' }).priority).toBe('urgent')
  })

  it('null は受け付けない(クリア不可の項目)', () => {
    expect(scCreateTicket.safeParse({ boardId, title: 'x', priority: null }).success).toBe(false)
  })

  it('未知の値は受け付けない', () => {
    expect(scCreateTicket.safeParse({ boardId, title: 'x', priority: 'highest' }).success).toBe(false)
  })
})

describe('scPatchTicket: 渡された項目だけを更新する', () => {
  it('未指定の項目には既定値を入れない', () => {
    const res = scPatchTicket.parse({ id: ticketId })
    expect(res.priority, '既定値を補うと無変更のはずの項目を上書きしてしまう').toBeUndefined()
    expect(res.title).toBeUndefined()
    expect(res.tagIds).toBeUndefined()
  })

  it('null はクリアとして受け付ける(期日・担当者)', () => {
    const res = scPatchTicket.parse({ id: ticketId, dueDate: null, assigneeId: null })
    expect(res.dueDate).toBeNull()
    expect(res.assigneeId).toBeNull()
  })

  it('クリア不可の項目に null は受け付けない', () => {
    expect(scPatchTicket.safeParse({ id: ticketId, priority: null }).success, '優先度').toBe(false)
    expect(scPatchTicket.safeParse({ id: ticketId, title: null }).success, '件名').toBe(false)
  })
})

describe('zDueDate: 期日は YYYY-MM-DD の実在する日付のみ', () => {
  const parseDueDate = (dueDate: string) => scPatchTicket.safeParse({ id: ticketId, dueDate }).success

  it('実在する日付は受け付ける', () => {
    expect(parseDueDate('2026-01-15')).toBe(true)
    expect(parseDueDate('2024-02-29'), '閏年の 2/29').toBe(true)
  })

  it('桁数は正しいが存在しない日付は受け付けない', () => {
    expect(parseDueDate('2026-02-31'), '2月31日').toBe(false)
    expect(parseDueDate('2026-02-29'), '平年の 2/29').toBe(false)
    expect(parseDueDate('2026-13-01'), '13月').toBe(false)
  })

  it('区切りが違う形式は受け付けない', () => {
    expect(parseDueDate('2026/01/01')).toBe(false)
    expect(parseDueDate('20260101')).toBe(false)
  })
})

describe('scTicketSearch: 担当者は未選択 / 未割り当て / userId', () => {
  const parseAssignee = (assignee: unknown) => scTicketSearch.safeParse({ assignee })

  it('未指定・null は「すべて」として通す', () => {
    expect(scTicketSearch.parse({}).assignee, '未指定').toBeUndefined()
    expect(scTicketSearch.parse({ assignee: null }).assignee, 'null').toBeNull()
  })

  it('未割り当てのセンチネルと userId を受け付ける', () => {
    expect(parseAssignee(ASSIGNEE_NONE).success, '未割り当て').toBe(true)
    expect(parseAssignee(userId).success, 'userId').toBe(true)
  })

  it('userId でもセンチネルでもない文字列は受け付けない', () => {
    expect(parseAssignee('me').success, '旧仕様の me').toBe(false)
    expect(parseAssignee('any').success, '旧仕様の any').toBe(false)
  })
})

describe('scMoveTicket', () => {
  it('レーン内位置は 0 以上の整数のみ', () => {
    expect(scMoveTicket.parse({ id: ticketId, status: 'doing', index: 0 }).index).toBe(0)
    expect(scMoveTicket.safeParse({ id: ticketId, status: 'doing', index: -1 }).success, '負数').toBe(false)
    expect(scMoveTicket.safeParse({ id: ticketId, status: 'doing', index: 1.5 }).success, '小数').toBe(false)
  })

  it('未知のステータスは受け付けない', () => {
    expect(scMoveTicket.safeParse({ id: ticketId, status: 'unknown', index: 0 }).success).toBe(false)
  })
})
