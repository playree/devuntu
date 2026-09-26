/**
 * plan / report への承認・差し戻し(agent-decision.ts)の単体テスト
 *
 * ボタンを出す条件(返答待ちの判定)と、返答ごとのチケットの状態遷移を確かめる。
 */

import { decideAgentComment, findLatestAgentDecision, findPendingAgentDecision } from '@/lib/agent/agent-decision'
import { assertTicketAccess, type TicketAccess } from '@/lib/board/board-access'
import { insertComment } from '@/lib/board/ticket-mutation'
import { moveTicketToLane } from '@/lib/board/ticket-write'
import { ClientError, errInvalidOperation } from '@/lib/error'
import { enqueueTicketMoved } from '@/lib/notify/notify-trigger'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeTx = {
  $queryRaw: vi.fn(),
  ticket: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  ticketComment: { findFirst: vi.fn(), findUnique: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(fakeTx)) },
}))

vi.mock('@/lib/board/board-access', () => ({ assertTicketAccess: vi.fn() }))
vi.mock('@/lib/board/ticket-mutation', () => ({ insertComment: vi.fn(async () => ({ id: 'reply-1' })) }))
vi.mock('@/lib/board/ticket-write', () => ({ moveTicketToLane: vi.fn(async () => ({ status: 'done' })) }))
vi.mock('@/lib/notify/notify-trigger', () => ({ enqueueTicketMoved: vi.fn() }))

const AGENT = 'agent-1'
const PLAN_AT = new Date('2026-09-26T00:00:00Z')

const ticket = {
  id: 't1',
  assigneeId: AGENT,
  assigneeIsAgent: true,
  agentState: 'planned' as const,
  status: 'doing' as const,
}

const access = { ticketId: 't1', boardId: 'b1', status: 'doing', canEdit: true } as TicketAccess

/** エージェントの最新コメントと、その後の返信の有無を順に返す */
const mockComments = (last: { id: string; type: 'plan' | 'report' | null } | null, hasReply = false) => {
  fakeTx.ticketComment.findFirst
    .mockResolvedValueOnce(last && { ...last, createdAt: PLAN_AT })
    .mockResolvedValueOnce(hasReply ? { id: 'reply' } : null)
}

beforeEach(() => {
  vi.clearAllMocks()
  fakeTx.ticketComment.findFirst.mockReset()
  vi.mocked(assertTicketAccess).mockResolvedValue(access)
})

describe('findPendingAgentDecision', () => {
  it('返信待ちのプランが対象になる', async () => {
    mockComments({ id: 'plan-1', type: 'plan' })
    expect(await findPendingAgentDecision(ticket, fakeTx as never)).toEqual({ commentId: 'plan-1', type: 'plan' })
  })

  it('完了報告の後は report が対象になる', async () => {
    mockComments({ id: 'report-1', type: 'report' })
    expect(await findPendingAgentDecision({ ...ticket, agentState: 'done' }, fakeTx as never)).toEqual({
      commentId: 'report-1',
      type: 'report',
    })
  })

  it('既に誰かが返信していれば対象にしない', async () => {
    mockComments({ id: 'plan-1', type: 'plan' }, true)
    expect(await findPendingAgentDecision(ticket, fakeTx as never)).toBeNull()
  })

  it('質問(通常コメント)で返答待ちになっている場合は対象にしない', async () => {
    mockComments({ id: 'question-1', type: null })
    expect(await findPendingAgentDecision(ticket, fakeTx as never)).toBeNull()
  })

  it('処理中・完了済みのチケット・担当が人間なら問い合わせもしない', async () => {
    expect(await findPendingAgentDecision({ ...ticket, agentState: 'running' }, fakeTx as never)).toBeNull()
    expect(await findPendingAgentDecision({ ...ticket, status: 'done' }, fakeTx as never)).toBeNull()
    expect(await findPendingAgentDecision({ ...ticket, assigneeIsAgent: false }, fakeTx as never)).toBeNull()
    expect(fakeTx.ticketComment.findFirst).not.toHaveBeenCalled()
  })
})

describe('decideAgentComment', () => {
  const setup = (
    agentState: 'planned' | 'done',
    type: 'plan' | 'report',
    target: { id: string; parentId: string | null } = { id: 'c1', parentId: null },
  ) => {
    fakeTx.ticketComment.findUnique.mockResolvedValue({ ...target, ticketId: 't1' })
    fakeTx.ticket.findUniqueOrThrow.mockResolvedValue({
      id: 't1',
      assigneeId: AGENT,
      agentState,
      status: 'doing',
      assignee: { isAgent: true },
    })
    mockComments({ id: 'c1', type })
  }

  it('プランの承認は返信を投稿するだけ(状態は revise の再開条件に任せる)', async () => {
    setup('planned', 'plan')

    await decideAgentComment({ id: 'u1' }, { commentId: 'c1', decision: 'approved', content: '承認' })

    expect(assertTicketAccess).toHaveBeenCalledWith({ id: 'u1' }, 't1', 'edit', fakeTx)
    expect(insertComment).toHaveBeenCalledWith(fakeTx, { id: 'u1' }, access, {
      ticketId: 't1',
      content: '承認',
      parentId: 'c1',
      decision: 'approved',
    })
    expect(fakeTx.ticket.update).not.toHaveBeenCalled()
    expect(moveTicketToLane).not.toHaveBeenCalled()
  })

  it('対象が返信なら、その親のスレッドへ返信する', async () => {
    setup('planned', 'plan', { id: 'c1', parentId: 'root' })

    await decideAgentComment({ id: 'u1' }, { commentId: 'c1', decision: 'rejected', content: '理由' })

    expect(insertComment).toHaveBeenCalledWith(
      fakeTx,
      { id: 'u1' },
      access,
      expect.objectContaining({ parentId: 'root' }),
    )
  })

  it('報告の承認でチケットを完了にする', async () => {
    setup('done', 'report')

    await decideAgentComment({ id: 'u1' }, { commentId: 'c1', decision: 'approved', content: '完了' })

    expect(moveTicketToLane).toHaveBeenCalledWith(fakeTx, { access, status: 'done' })
    expect(enqueueTicketMoved).toHaveBeenCalledWith(
      { actorId: 'u1', ticketId: 't1', before: 'doing', after: 'done' },
      fakeTx,
    )
  })

  it('報告の差し戻しで返信待ちへ戻し、revise で再開させる', async () => {
    setup('done', 'report')

    await decideAgentComment({ id: 'u1' }, { commentId: 'c1', decision: 'rejected', content: '理由' })

    expect(fakeTx.ticket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { agentState: 'planned' } })
    expect(moveTicketToLane).not.toHaveBeenCalled()
  })

  it('返答待ちでないコメントには返答できない', async () => {
    setup('planned', 'plan')
    fakeTx.ticketComment.findUnique.mockResolvedValue({ id: 'old', parentId: null, ticketId: 't1' })

    await expect(
      decideAgentComment({ id: 'u1' }, { commentId: 'old', decision: 'approved', content: '承認' }),
    ).rejects.toBeInstanceOf(ClientError)
    expect(insertComment).not.toHaveBeenCalled()
  })

  it('チケットを編集できない人(非メンバーの承認者など)は返答できない', async () => {
    setup('planned', 'plan')
    vi.mocked(assertTicketAccess).mockRejectedValue(errInvalidOperation())

    await expect(
      decideAgentComment({ id: 'u1' }, { commentId: 'c1', decision: 'approved', content: '承認' }),
    ).rejects.toBeInstanceOf(ClientError)
    expect(insertComment).not.toHaveBeenCalled()
  })
})

describe('findLatestAgentDecision', () => {
  it('エージェントの最新コメントより後の返答だけを探す', async () => {
    fakeTx.ticketComment.findFirst
      .mockResolvedValueOnce({ createdAt: PLAN_AT })
      .mockResolvedValueOnce({ id: 'd1', decision: 'approved', content: '承認' })

    expect(await findLatestAgentDecision('t1', AGENT, fakeTx as never)).toEqual({
      id: 'd1',
      decision: 'approved',
      content: '承認',
    })
    expect(fakeTx.ticketComment.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { ticketId: 't1', decision: { not: null }, createdAt: { gt: PLAN_AT } } }),
    )
  })

  it('エージェント自身のコメントが無ければ、残っている返答を渡さない', async () => {
    fakeTx.ticketComment.findFirst.mockResolvedValueOnce(null)

    expect(await findLatestAgentDecision('t1', AGENT, fakeTx as never)).toBeNull()
    expect(fakeTx.ticketComment.findFirst).toHaveBeenCalledTimes(1)
  })
})
