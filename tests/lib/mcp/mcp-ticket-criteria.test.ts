/** 人の経路の MCP から受け入れ条件の自己申告を記録する */

import { assertTicketAccess, type TicketAccess } from '@/lib/board/board-access'
import { assertAgentCriteria, listTicketCriteria, writeAgentCriteria } from '@/lib/board/ticket-criterion'
import { reportTicketCriteriaForMcp } from '@/lib/mcp/mcp-ticket'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { oauthAuth } from '../../helpers/resource-auth'

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({}, { tx: fakeTx }))

vi.mock('@/lib/board/board-access', () => ({
  assertTicketAccess: vi.fn(),
  findTicketIdByDisplayId: vi.fn(),
}))

vi.mock('@/lib/board/ticket-criterion', () => ({
  assertAgentCriteria: vi.fn(),
  writeAgentCriteria: vi.fn(),
  listTicketCriteria: vi.fn(),
}))

const fakeTx = vi.hoisted(() => ({}))

const auth = oauthAuth()
const TICKET_ID = '0195c1e0-0000-7000-8000-0000000000aa'
const CRITERION_ID = '0195c1e0-0000-7000-8000-0000000000c1'
const reports = [{ id: CRITERION_ID, met: true, evidence: 'テストで確認' }]

const access = (override: Partial<TicketAccess> = {}): TicketAccess => ({
  canView: true,
  canEdit: true,
  canDelete: true,
  canEditAgentMode: false,
  ticketId: TICKET_ID,
  boardId: 'board-1',
  boardKind: 'team',
  createdById: auth.user.id,
  assigneeId: null,
  assigneeIsAgent: false,
  status: 'doing',
  boardRole: 'member',
  ...override,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertTicketAccess).mockResolvedValue(access())
  vi.mocked(listTicketCriteria).mockResolvedValue([
    {
      id: CRITERION_ID,
      text: '条件1',
      checkedAt: null,
      checkedByName: '',
      agentMet: true,
      agentEvidence: 'テストで確認',
      agentReportedAt: new Date(),
    },
  ])
})

describe('reportTicketCriteriaForMcp', () => {
  it('編集権限を確かめてから、同じトランザクションで検証と記録を行う', async () => {
    const result = await reportTicketCriteriaForMcp(auth, TICKET_ID, reports)

    expect(assertTicketAccess).toHaveBeenCalledWith(auth.user, TICKET_ID, 'edit', fakeTx)
    expect(assertAgentCriteria).toHaveBeenCalledWith(fakeTx, TICKET_ID, reports)
    expect(writeAgentCriteria).toHaveBeenCalledWith(fakeTx, reports)
    expect(result).toEqual({
      acceptanceCriteria: [{ id: CRITERION_ID, text: '条件1', agentMet: true, agentEvidence: 'テストで確認' }],
    })
  })

  it('メンバーは他人が担当のチケットに申告できない(update_ticket と同じ制限)', async () => {
    vi.mocked(assertTicketAccess).mockResolvedValue(access({ assigneeId: 'someone-else' }))

    await expect(reportTicketCriteriaForMcp(auth, TICKET_ID, reports)).rejects.toThrow()
    expect(writeAgentCriteria).not.toHaveBeenCalled()
  })

  it('他のチケットの項目が混ざっていたら何も記録しない', async () => {
    vi.mocked(assertAgentCriteria).mockRejectedValueOnce(new Error('invalid'))

    await expect(reportTicketCriteriaForMcp(auth, TICKET_ID, reports)).rejects.toThrow()
    expect(writeAgentCriteria).not.toHaveBeenCalled()
  })
})
