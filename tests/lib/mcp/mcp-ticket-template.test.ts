/** create_ticket の templateId: 明示した項目を優先し、指定の無い項目だけテンプレートで埋めて作成する */

import { createTicketForMcp } from '@/lib/mcp/mcp-ticket'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { oauthAuth } from '../../helpers/resource-auth'

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({}))

vi.mock('@/lib/board/board-access', () => ({
  assertBoardAccess: vi.fn(),
  assertTicketAccess: vi.fn(),
  findTicketIdByDisplayId: vi.fn(),
  getAccessibleBoardIds: vi.fn(),
}))

vi.mock('@/lib/board/ticket-mutation', () => ({
  createTicket: vi.fn(async () => ({ id: 't1' })),
}))

vi.mock('@/lib/board/ticket-template', () => ({
  findTicketTemplate: vi.fn(),
}))

vi.mock('@/lib/mcp/mcp-board', () => ({
  resolveBoardId: vi.fn(async () => BOARD_ID),
}))

const { assertBoardAccess } = await import('@/lib/board/board-access')
const { createTicket } = await import('@/lib/board/ticket-mutation')
const { findTicketTemplate } = await import('@/lib/board/ticket-template')

const auth = oauthAuth()
const BOARD_ID = '0195c1e0-0000-7000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createTicketForMcp', () => {
  it('テンプレートの内容で作成し、明示した項目はそのまま使う', async () => {
    vi.mocked(findTicketTemplate).mockResolvedValueOnce({
      id: 'tpl-1',
      name: '不具合',
      content: '## 再現手順',
      criteria: ['再現しない'],
      tagIds: ['tag-1'],
      priority: 'high',
    })

    await createTicketForMcp(auth, {
      boardId: 'ABC',
      title: 'A',
      status: 'todo',
      priority: 'low',
      templateId: '不具合',
    })

    expect(assertBoardAccess).toHaveBeenCalledWith(auth.user, BOARD_ID, 'view')
    expect(findTicketTemplate).toHaveBeenCalledWith(BOARD_ID, '不具合')
    expect(createTicket).toHaveBeenCalledWith(auth.user, {
      boardId: BOARD_ID,
      title: 'A',
      status: 'todo',
      content: '## 再現手順',
      criteria: ['再現しない'],
      tagIds: ['tag-1'],
      priority: 'low',
    })
  })

  it('テンプレートを指定しなければ引かず、従来どおり medium / タグなしで作成する', async () => {
    await createTicketForMcp(auth, { boardId: 'ABC', title: 'A', status: 'todo' })

    expect(findTicketTemplate).not.toHaveBeenCalled()
    expect(assertBoardAccess).not.toHaveBeenCalled()
    expect(createTicket).toHaveBeenCalledWith(auth.user, {
      boardId: BOARD_ID,
      title: 'A',
      status: 'todo',
      tagIds: [],
      priority: 'medium',
    })
  })

  it('テンプレートが見つからなければ作成しない', async () => {
    vi.mocked(findTicketTemplate).mockRejectedValueOnce(new Error('not found'))

    await expect(
      createTicketForMcp(auth, { boardId: 'ABC', title: 'A', status: 'todo', templateId: 'nope' }),
    ).rejects.toThrow()
    expect(createTicket).not.toHaveBeenCalled()
  })
})
