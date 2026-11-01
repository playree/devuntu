/**
 * add_ticket_comment の type=report は、プランへの返信を待つべきチケットならエージェントに投稿させない。
 * プラン先行のチケットで、返信前に報告書(承認 / 差戻のボタン付き)が出ないようにするため
 * (返信待ちの判定そのものは agent-plan-guard.test.ts で見る)
 */

import { AGENT_PLAN_ONLY } from '@/lib/agent/agent-plan-guard'
import { addComment } from '@/lib/board/ticket-mutation'
import { ClientError } from '@/lib/error'
import { addTicketCommentForMcp } from '@/lib/mcp/mcp-ticket'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentAuth, oauthAuth } from '../../helpers/resource-auth'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    agentRunner: ['findUnique'],
    agentRun: ['findFirst'],
    ticket: ['findUnique'],
  }),
)
vi.mock('@/lib/board/ticket-mutation', () => ({ addComment: vi.fn() }))

const TICKET_ID = '0195c1e0-0000-7000-8000-0000000000aa'
const COMMENT_ID = '0195c1e0-0000-7000-8000-0000000000cc'

const agentRunner = vi.mocked(prisma.agentRunner)
const agentRun = vi.mocked(prisma.agentRun)
const ticket = vi.mocked(prisma.ticket)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(addComment).mockResolvedValue({ id: COMMENT_ID, mentionedUserIds: [], announced: false })
  agentRunner.findUnique.mockResolvedValue({ id: 'r1' } as never)
})

const rejectedType = async (run: () => Promise<unknown>) => {
  const error = await run().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ClientError)
  return (error as ClientError).errorType
}

describe('addTicketCommentForMcp: プランへの返信待ちの報告書', () => {
  it('plan の実行中なら、エージェントの報告書は投稿しない', async () => {
    agentRun.findFirst.mockResolvedValue({ action: 'plan', status: 'running' } as never)
    ticket.findUnique.mockResolvedValue({ agentState: 'running' } as never)

    expect(await rejectedType(() => addTicketCommentForMcp(agentAuth(), TICKET_ID, '報告', 'report'))).toBe(
      AGENT_PLAN_ONLY,
    )
    expect(agentRunner.findUnique).toHaveBeenCalledWith({ where: { userId: 'a1' }, select: { id: true } })
    expect(agentRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { runnerId: 'r1', ticketId: TICKET_ID } }),
    )
    expect(addComment).not.toHaveBeenCalled()
  })

  it('planned で閉じた直後(返信待ち)も、エージェントの報告書は投稿しない', async () => {
    agentRun.findFirst.mockResolvedValue({ action: 'plan', status: 'succeeded' } as never)
    ticket.findUnique.mockResolvedValue({ agentState: 'planned' } as never)

    expect(await rejectedType(() => addTicketCommentForMcp(agentAuth(), TICKET_ID, '報告', 'report'))).toBe(
      AGENT_PLAN_ONLY,
    )
    expect(addComment).not.toHaveBeenCalled()
  })

  it('返信を受けた次の実行中なら、エージェントの報告書を投稿できる', async () => {
    agentRun.findFirst.mockResolvedValue({ action: 'revise', status: 'running' } as never)
    ticket.findUnique.mockResolvedValue({ agentState: 'running' } as never)

    expect(await addTicketCommentForMcp(agentAuth(), TICKET_ID, '報告', 'report')).toEqual({ id: COMMENT_ID })
  })

  it('自動運用の設定が無いエージェントは判定しない', async () => {
    agentRunner.findUnique.mockResolvedValue(null)

    expect(await addTicketCommentForMcp(agentAuth(), TICKET_ID, '報告', 'report')).toEqual({ id: COMMENT_ID })
    expect(agentRun.findFirst).not.toHaveBeenCalled()
  })

  it.each([null, 'plan'] as const)('返信待ちでも type=%s は投稿できる', async (type) => {
    expect(await addTicketCommentForMcp(agentAuth(), TICKET_ID, 'プラン', type)).toEqual({ id: COMMENT_ID })
    expect(agentRunner.findUnique).not.toHaveBeenCalled()
  })

  it('人の経路の報告書は判定しない', async () => {
    expect(await addTicketCommentForMcp(oauthAuth(), TICKET_ID, '報告', 'report')).toEqual({ id: COMMENT_ID })
    expect(agentRunner.findUnique).not.toHaveBeenCalled()
  })
})
