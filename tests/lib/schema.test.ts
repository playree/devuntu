/**
 * Zod スキーマの単体テスト
 *
 * 既定値・必須の境界だけを対象にする(項目ごとの文字数制限は UI の constraintSchema が担う)。
 */

import { scCreateTicket, scMoveTicket, scUpdateTicket } from '@/lib/schema'
import { describe, expect, it } from 'vitest'

const boardId = '01920000-0000-7000-8000-000000000001'
const ticketId = '01920000-0000-7000-8000-000000000002'

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

  it('scUpdateTicket も同じ既定値を引き継ぐ', () => {
    expect(scUpdateTicket.parse({ id: ticketId, title: 'x' }).priority).toBe('medium')
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
