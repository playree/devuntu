/**
 * add_ticket_comment の type=report は、エージェントが plan の実行中なら投稿させない。
 * プラン先行のチケットで、承認前に報告書(承認 / 差戻のボタン付き)が出ないようにするため
 */

import { AGENT_PLAN_ONLY } from '@/lib/agent/agent-plan-guard'
import { addComment } from '@/lib/board/ticket-mutation'
import { ClientError } from '@/lib/error'
import { addTicketCommentForMcp } from '@/lib/mcp/mcp-ticket'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentAuth, oauthAuth } from '../../helpers/resource-auth'

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({ agentRun: ['count'] }))
vi.mock('@/lib/board/ticket-mutation', () => ({ addComment: vi.fn() }))

const TICKET_ID = '0195c1e0-0000-7000-8000-0000000000aa'
const COMMENT_ID = '0195c1e0-0000-7000-8000-0000000000cc'

const agentRunCount = vi.mocked(prisma.agentRun.count)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(addComment).mockResolvedValue({ id: COMMENT_ID, mentionedUserIds: [], announced: false })
})

describe('addTicketCommentForMcp: plan の実行中の報告書', () => {
  it('plan の実行中なら、エージェントの報告書は投稿しない', async () => {
    agentRunCount.mockResolvedValue(1)

    const error = await addTicketCommentForMcp(agentAuth(), TICKET_ID, '報告', 'report').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ClientError)
    expect((error as ClientError).errorType).toBe(AGENT_PLAN_ONLY)
    expect(agentRunCount).toHaveBeenCalledWith({
      where: { ticketId: TICKET_ID, status: 'running', action: 'plan', runner: { userId: 'a1' } },
    })
    expect(addComment).not.toHaveBeenCalled()
  })

  it('plan の実行中でなければ、エージェントの報告書を投稿できる', async () => {
    agentRunCount.mockResolvedValue(0)

    expect(await addTicketCommentForMcp(agentAuth(), TICKET_ID, '報告', 'report')).toEqual({ id: COMMENT_ID })
  })

  it.each([null, 'plan'] as const)('plan の実行中でも type=%s は投稿できる', async (type) => {
    agentRunCount.mockResolvedValue(1)

    expect(await addTicketCommentForMcp(agentAuth(), TICKET_ID, 'プラン', type)).toEqual({ id: COMMENT_ID })
    expect(agentRunCount).not.toHaveBeenCalled()
  })

  it('人の経路の報告書は実行の状態を見ない', async () => {
    expect(await addTicketCommentForMcp(oauthAuth(), TICKET_ID, '報告', 'report')).toEqual({ id: COMMENT_ID })
    expect(agentRunCount).not.toHaveBeenCalled()
  })
})
