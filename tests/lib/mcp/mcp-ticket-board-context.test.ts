/** get_ticket の boardContext(ボードの AI 向けコンテキスト)は、ボードのメンバーにだけ設定時のみ載せる */

import { assertTicketAccess, type TicketAccess } from '@/lib/board/board-access'
import { getTicketForMcp } from '@/lib/mcp/mcp-ticket'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { oauthAuth } from '../../helpers/resource-auth'

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({ ticket: ['findUnique'] }))

vi.mock('@/lib/board/board-access', () => ({
  assertTicketAccess: vi.fn(),
  findTicketIdByDisplayId: vi.fn(),
}))

vi.mock('@/lib/board/ticket-link', () => ({ listTicketLinks: vi.fn(async () => []) }))
vi.mock('@/lib/board/ticket-criterion', () => ({ listTicketCriteria: vi.fn(async () => []) }))
vi.mock('@/lib/board/ticket-activity', () => ({ listTicketActivities: vi.fn(async () => []) }))
vi.mock('@/lib/board/ticket-relation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/board/ticket-relation')>()
  return { ...actual, listTicketRelations: vi.fn(async () => actual.EMPTY_TICKET_RELATIONS) }
})
vi.mock('@/lib/board/ticket-sequence', () => ({ findWaitingTicketIds: vi.fn(async () => new Set()) }))

const auth = oauthAuth()
const TICKET_ID = '0195c1e0-0000-7000-8000-0000000000aa'

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

const ticketRow = (aiContext: string | null) => ({
  number: 1,
  board: { name: 'ボード', key: 'ABC', aiContext },
  title: 'チケット',
  content: null,
  status: 'doing',
  priority: 'medium',
  dueDate: null,
  completedAt: null,
  tags: [],
  assignee: null,
  createdBy: null,
  childAdvance: 'done',
  createdAt: new Date(),
  updatedAt: new Date(),
  comments: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertTicketAccess).mockResolvedValue(access())
})

describe('getTicketForMcp の boardContext', () => {
  it('ボードのメンバーには設定済みのコンテキストを返す', async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(ticketRow('## 前提') as never)

    expect(await getTicketForMcp(auth, TICKET_ID)).toMatchObject({ boardContext: '## 前提' })
  })

  it('未設定なら項目ごと載せない', async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(ticketRow(null) as never)

    expect(await getTicketForMcp(auth, TICKET_ID)).not.toHaveProperty('boardContext')
  })

  it('ボードのメンバーでない利用者(承認者)には返さない', async () => {
    vi.mocked(assertTicketAccess).mockResolvedValue(access({ boardRole: null, canEdit: false, canDelete: false }))
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(ticketRow('## 前提') as never)

    expect(await getTicketForMcp(auth, TICKET_ID)).not.toHaveProperty('boardContext')
  })
})
