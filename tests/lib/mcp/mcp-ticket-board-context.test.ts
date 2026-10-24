/**
 * get_ticket の boardContext(ボードの AI 向けコンテキスト)・mergeCompletion・ボードノートの索引・announcementEnabled は、
 * ボードのメンバーにだけ設定時のみ載せる
 */

import { findBoardNoteIndex } from '@/lib/board-note/board-note'
import { assertTicketAccess, type TicketAccess } from '@/lib/board/board-access'
import { getTicketForMcp } from '@/lib/mcp/mcp-ticket'
import { isChannelNotifyEnabled } from '@/lib/notify/notify-board-setting'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentAuth, oauthAuth } from '../../helpers/resource-auth'

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
vi.mock('@/lib/board-note/board-note', () => ({ findBoardNoteIndex: vi.fn(async () => ({})) }))
vi.mock('@/lib/notify/notify-board-setting', () => ({ isChannelNotifyEnabled: vi.fn(async () => false) }))

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

const MERGE_ON = [{ provider: 'github', completeOnMerge: true, mergeCriteriaCheck: 'checkedOrReported' }]

const ticketRow = (aiContext: string | null, gitSettings: unknown[] = []) => ({
  number: 1,
  board: { name: 'ボード', key: 'ABC', aiContext, gitSettings },
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

describe('getTicketForMcp の mergeCompletion', () => {
  it('マージで自動完了するボードでは provider ごとの受け入れ条件の判定を返す', async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(ticketRow(null, MERGE_ON) as never)

    expect(await getTicketForMcp(auth, TICKET_ID)).toMatchObject({
      mergeCompletion: { github: { criteriaCheck: 'checkedOrReported' } },
    })
  })

  it('マージで自動完了しないボードでは項目ごと載せない', async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(
      ticketRow(null, [{ provider: 'github', completeOnMerge: false, mergeCriteriaCheck: 'checked' }]) as never,
    )

    expect(await getTicketForMcp(auth, TICKET_ID)).not.toHaveProperty('mergeCompletion')
  })

  it('ボードのメンバーでない利用者(承認者)には返さない', async () => {
    vi.mocked(assertTicketAccess).mockResolvedValue(access({ boardRole: null, canEdit: false, canDelete: false }))
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(ticketRow(null, MERGE_ON) as never)

    expect(await getTicketForMcp(auth, TICKET_ID)).not.toHaveProperty('mergeCompletion')
  })
})

describe('getTicketForMcp のボードノートの索引', () => {
  const INDEX = { boardKnowledge: ['deploy-flow: 本番デプロイの順序'], boardMemory: ['migrate-gotcha: 失敗する件'] }

  it('ボードのメンバーには索引とボードキーを返す', async () => {
    vi.mocked(findBoardNoteIndex).mockResolvedValue(INDEX)
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(ticketRow(null) as never)

    expect(await getTicketForMcp(auth, TICKET_ID)).toMatchObject({ ...INDEX, boardKey: 'ABC' })
    expect(findBoardNoteIndex).toHaveBeenCalledWith('board-1')
  })

  it('ボードのメンバーでない利用者(承認者)には返さない', async () => {
    vi.mocked(findBoardNoteIndex).mockResolvedValue(INDEX)
    vi.mocked(assertTicketAccess).mockResolvedValue(access({ boardRole: null, canEdit: false, canDelete: false }))
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(ticketRow(null) as never)

    const result = await getTicketForMcp(auth, TICKET_ID)
    expect(result).not.toHaveProperty('boardKnowledge')
    expect(result).not.toHaveProperty('boardMemory')
    expect(findBoardNoteIndex).not.toHaveBeenCalled()
  })
})

describe('getTicketForMcp の announcementEnabled', () => {
  it('アナウンスが Slack へ流れるボードなら、メンバーには true を返す', async () => {
    vi.mocked(isChannelNotifyEnabled).mockResolvedValue(true)
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(ticketRow(null) as never)

    expect(await getTicketForMcp(auth, TICKET_ID)).toMatchObject({ announcementEnabled: true })
    expect(isChannelNotifyEnabled).toHaveBeenCalledWith('board-1', 'announcement')
  })

  it('流れないボードでは項目ごと載せない', async () => {
    vi.mocked(isChannelNotifyEnabled).mockResolvedValue(false)
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(ticketRow(null) as never)

    expect(await getTicketForMcp(auth, TICKET_ID)).not.toHaveProperty('announcementEnabled')
  })

  it('アナウンスを投稿できないエージェントには返さない', async () => {
    vi.mocked(isChannelNotifyEnabled).mockResolvedValue(true)
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(ticketRow(null) as never)

    expect(await getTicketForMcp(agentAuth(), TICKET_ID)).not.toHaveProperty('announcementEnabled')
    expect(isChannelNotifyEnabled).not.toHaveBeenCalled()
  })

  it('ボードのメンバーでない利用者(承認者)には返さない', async () => {
    vi.mocked(isChannelNotifyEnabled).mockResolvedValue(true)
    vi.mocked(assertTicketAccess).mockResolvedValue(access({ boardRole: null, canEdit: false, canDelete: false }))
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(ticketRow(null) as never)

    expect(await getTicketForMcp(auth, TICKET_ID)).not.toHaveProperty('announcementEnabled')
    expect(isChannelNotifyEnabled).not.toHaveBeenCalled()
  })
})
