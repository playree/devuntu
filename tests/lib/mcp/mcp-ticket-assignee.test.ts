/** create_ticket / update_ticket の assigneeId: 'me' は自分のユーザーIDへ解決し、それ以外はそのまま渡す */

import { createTicketForMcp, updateTicketForMcp } from '@/lib/mcp/mcp-ticket'
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
  updateTicket: vi.fn(async () => ({ id: 't1' })),
}))

vi.mock('@/lib/mcp/mcp-board', () => ({
  resolveBoardId: vi.fn(async () => BOARD_ID),
}))

const { createTicket, updateTicket } = await import('@/lib/board/ticket-mutation')

const auth = oauthAuth()
const BOARD_ID = '0195c1e0-0000-7000-8000-000000000001'
const TICKET_ID = '0195c1e0-0000-7000-8000-0000000000t1'
const OTHER = '0195c1e0-0000-7000-8000-0000000000u2'

/** createTicket / updateTicket に渡った担当者 */
const createdAssignee = () => vi.mocked(createTicket).mock.calls[0][1].assigneeId
const updatedAssignee = () => vi.mocked(updateTicket).mock.calls[0][2].assigneeId

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createTicketForMcp: 担当者', () => {
  it("'me' は自分のユーザーIDで作成する", async () => {
    await createTicketForMcp(auth, { boardId: 'ABC', title: 'A', status: 'doing', assigneeId: 'me' })
    expect(createdAssignee()).toBe(auth.user.id)
  })

  it('ユーザーID / 未指定はそのまま渡す', async () => {
    await createTicketForMcp(auth, { boardId: 'ABC', title: 'A', status: 'todo', assigneeId: OTHER })
    await createTicketForMcp(auth, { boardId: 'ABC', title: 'B', status: 'todo' })
    expect(vi.mocked(createTicket).mock.calls.map(([, input]) => input.assigneeId)).toEqual([OTHER, undefined])
  })
})

describe('updateTicketForMcp: 担当者', () => {
  it("'me' は自分のユーザーIDへ変更する", async () => {
    await updateTicketForMcp(auth, TICKET_ID, { assigneeId: 'me' })
    expect(updatedAssignee()).toBe(auth.user.id)
  })

  it('null(外す)と未指定(変更しない)は区別したまま渡す', async () => {
    await updateTicketForMcp(auth, TICKET_ID, { assigneeId: null })
    await updateTicketForMcp(auth, TICKET_ID, { title: '更新後' })
    expect(vi.mocked(updateTicket).mock.calls.map(([, , input]) => input.assigneeId)).toEqual([null, undefined])
  })
})
