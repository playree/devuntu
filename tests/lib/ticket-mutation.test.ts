/**
 * チケット / コメントの変更処理(ticket-mutation.ts)の単体テスト
 *
 * Web の Server Action は共通関数を直接呼び、MCP は `*ForMcp` から呼ぶ。
 * 同じ入力に対して同じ結果になることを、両方の呼び方に同じ期待値を当てて確かめる。
 * Server Action はセッションが要るため、Web 側は Action と同じ引数で共通関数を呼んで代用する。
 */

import {
  assertBoardAccess,
  assertTicketAccess,
  moveTicketToLane,
  reassignContentAttachments,
  type TicketAccess,
} from '@/lib/board/board'
import { createTicket, deleteTicket, updateTicket, type UpdateTicketInput } from '@/lib/board/ticket-mutation'
import { ClientError, errInvalidOperation } from '@/lib/error'
import { createTicketForMcp, deleteTicketForMcp, updateTicketForMcp } from '@/lib/mcp/mcp-ticket'
import { enqueueTicketUpdated } from '@/lib/notify/notify-trigger'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeTx = {
  ticket: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    aggregate: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
}

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(fakeTx)) },
}))

vi.mock('@/lib/board/board', () => ({
  assertBoardAccess: vi.fn(),
  assertBoardAssignee: vi.fn(),
  assertReplyTarget: vi.fn(),
  assertTicketAccess: vi.fn(),
  findTicketIdByDisplayId: vi.fn(),
  getAccessibleBoardIds: vi.fn(),
  getBoardMentionCandidates: vi.fn(async () => []),
  getTicketMentionCandidates: vi.fn(async () => []),
  moveTicketToLane: vi.fn(),
  nextTicketNumber: vi.fn(async () => 7),
  reassignContentAttachments: vi.fn(),
}))

vi.mock('@/lib/board/tag', () => ({
  assertTagIdsInBoard: vi.fn(async (_tx: unknown, _boardId: string, ids: string[]) => ids),
  syncTicketTags: vi.fn(),
}))

vi.mock('@/lib/mcp/mcp-board', () => ({ resolveBoardId: vi.fn(async (id: string) => id) }))

vi.mock('@/lib/notify/notify-trigger', () => ({
  enqueueTicketCommented: vi.fn(),
  enqueueTicketCreated: vi.fn(),
  enqueueTicketMoved: vi.fn(),
  enqueueTicketUpdated: vi.fn(),
}))

// 表示ID の形式でなければ resolveTicketId はそのまま返すので、UUID 形式の ID を使う
const TICKET_ID = '019eef64-6cc1-78f1-8f50-1ef869860010'
const AGENT_A = 'agent-a'
const AGENT_B = 'agent-b'
const HUMAN = 'human-1'

const auth: ResourceAuth = {
  user: { id: 'u1', name: 'tester', email: 'test@example.com', role: null },
  scopes: ['mcp'],
  kind: 'oauth',
  clientId: 'test-client',
}

const baseAccess: TicketAccess = {
  canView: true,
  canEdit: true,
  canDelete: true,
  canEditAgentMode: false,
  ticketId: TICKET_ID,
  boardId: 'board-1',
  boardKind: 'team',
  createdById: 'u1',
  assigneeId: AGENT_A,
  assigneeIsAgent: true,
  status: 'todo',
  // MCP の追加制限(メンバーは他人担当を更新できない)に掛からないよう、既定はオーナーにする
  boardRole: 'owner',
}

const updateData = () => fakeTx.ticket.update.mock.calls[0][0].data

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertTicketAccess).mockResolvedValue(baseAccess)
  vi.mocked(assertBoardAccess).mockResolvedValue({
    boardId: 'board-1',
    kind: 'team',
    role: 'member',
    via: 'member',
    archived: false,
  })
  fakeTx.ticket.update.mockResolvedValue({
    id: TICKET_ID,
    title: 'チケット',
    number: 1,
    status: 'todo',
    board: { key: 'TST' },
  })
  fakeTx.ticket.create.mockResolvedValue({ id: 'new-ticket', title: '新規', number: 7, board: { key: 'TST' } })
  fakeTx.ticket.aggregate.mockResolvedValue({ _max: { order: null } })
  fakeTx.ticket.findUniqueOrThrow.mockResolvedValue({ mentionedUserIds: [] })
  vi.mocked(moveTicketToLane).mockResolvedValue({ id: TICKET_ID, status: 'done', order: 0 })
})

const updaters: [string, (input: UpdateTicketInput) => Promise<unknown>][] = [
  ['Web(patchTicket と同じ呼び方)', (input) => updateTicket(auth.user, TICKET_ID, input)],
  ['MCP(updateTicketForMcp)', (input) => updateTicketForMcp(auth, TICKET_ID, input)],
]

describe.each(updaters)('updateTicket: %s', (_label, update) => {
  it.each([
    ['人間', HUMAN],
    ['別のエージェント', AGENT_B],
    ['未割り当て', null],
  ])('担当をエージェントから%sへ付け替えると agentMode / agentState を消す', async (_to, assigneeId) => {
    await update({ assigneeId })

    expect(updateData()).toMatchObject({ assigneeId, agentMode: null, agentState: null })
  })

  it('同じ担当を指定し直しただけなら agentMode / agentState は触らない', async () => {
    await update({ assigneeId: AGENT_A })

    expect(updateData()).not.toHaveProperty('agentMode')
    expect(updateData()).not.toHaveProperty('agentState')
  })

  it('担当を指定しない更新では agentMode / agentState は触らない', async () => {
    await update({ title: '変更後' })

    expect(updateData()).toMatchObject({ title: '変更後' })
    expect(updateData()).not.toHaveProperty('agentMode')
  })

  it('本文の添付をチケットのボードへ付け替える', async () => {
    await update({ content: '本文' })

    expect(reassignContentAttachments).toHaveBeenCalledWith(fakeTx, '本文', 'board-1', auth.user, TICKET_ID)
  })

  it('担当の変更を通知に渡す', async () => {
    await update({ assigneeId: HUMAN })

    expect(enqueueTicketUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        before: { assigneeId: AGENT_A, status: 'todo' },
        after: { assigneeId: HUMAN, status: 'todo' },
      }),
      fakeTx,
    )
  })
})

describe('updateTicket のステータス変更', () => {
  it('status を指定するとレーンを移し、移動後のステータスを通知に渡す', async () => {
    const result = await updateTicket(auth.user, TICKET_ID, { status: 'done' })

    expect(moveTicketToLane).toHaveBeenCalledWith(fakeTx, { access: baseAccess, status: 'done' })
    expect(result).toMatchObject({ status: 'done' })
    expect(enqueueTicketUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ after: { assigneeId: AGENT_A, status: 'done' } }),
      fakeTx,
    )
  })

  it('同じ status ならレーンは動かさない', async () => {
    await updateTicket(auth.user, TICKET_ID, { status: 'todo' })

    expect(moveTicketToLane).not.toHaveBeenCalled()
  })
})

describe('MCP 固有の追加制限', () => {
  it('メンバーは他人が担当のチケットを更新できない(Web では更新できる)', async () => {
    vi.mocked(assertTicketAccess).mockResolvedValue({ ...baseAccess, boardRole: 'member', assigneeId: HUMAN })

    await expect(updateTicketForMcp(auth, TICKET_ID, { title: '変更' })).rejects.toThrow(ClientError)
    expect(fakeTx.ticket.update).not.toHaveBeenCalled()

    await expect(updateTicket(auth.user, TICKET_ID, { title: '変更' })).resolves.toMatchObject({ id: TICKET_ID })
  })

  it('自分が作成していないチケットは削除できない(Web では削除できる)', async () => {
    vi.mocked(assertTicketAccess).mockResolvedValue({ ...baseAccess, createdById: 'someone' })

    await expect(deleteTicketForMcp(auth, TICKET_ID)).rejects.toThrow(ClientError)
    expect(fakeTx.ticket.delete).not.toHaveBeenCalled()

    await expect(deleteTicket(auth.user, TICKET_ID)).resolves.toEqual({ id: TICKET_ID })
    expect(fakeTx.ticket.delete).toHaveBeenCalledWith({ where: { id: TICKET_ID } })
  })
})

const creators: [string, () => Promise<unknown>][] = [
  [
    'Web(createTicket と同じ呼び方)',
    () =>
      createTicket(auth.user, {
        boardId: 'board-1',
        title: '新規',
        content: '本文',
        status: 'todo',
        priority: 'medium',
        tagIds: [],
      }),
  ],
  [
    'MCP(createTicketForMcp)',
    () =>
      createTicketForMcp(auth, {
        boardId: 'board-1',
        title: '新規',
        content: '本文',
        status: 'todo',
        priority: 'medium',
        tagIds: [],
      }),
  ],
]

describe.each(creators)('createTicket: %s', (_label, create) => {
  it("ボードへの 'write'(アーカイブ済みを拒否)で認可する", async () => {
    await create()

    expect(assertBoardAccess).toHaveBeenCalledWith(auth.user, 'board-1', 'write', fakeTx)
  })

  it('書き込めないボードには作成しない', async () => {
    vi.mocked(assertBoardAccess).mockRejectedValue(errInvalidOperation())

    await expect(create()).rejects.toThrow(ClientError)
    expect(fakeTx.ticket.create).not.toHaveBeenCalled()
  })

  it('本文の添付は作成したチケット自身を除いて付け替える', async () => {
    await expect(create()).resolves.toEqual({ id: 'new-ticket', title: '新規', displayId: 'TST-7' })

    expect(reassignContentAttachments).toHaveBeenCalledWith(fakeTx, '本文', 'board-1', auth.user, 'new-ticket')
  })
})
