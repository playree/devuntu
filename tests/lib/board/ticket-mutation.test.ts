/**
 * チケット / コメントの変更処理(ticket-mutation.ts)の単体テスト
 *
 * Web の Server Action は共通関数を直接呼び、MCP は `*ForMcp` から呼ぶ。
 * 経路をパラメータにして、同じになるべき結果には同じ期待値を、MCP 固有の追加制限
 * (canMcpUpdateTicket / canMcpDeleteTicket)で違うべき結果には経路ごとの期待値を当てる。
 * Server Action はセッションが要るため、Web 側は Action と同じ引数で共通関数を呼んで代用する。
 */

import { discardAutoReviseTriggers } from '@/lib/agent/agent-auto-revise'
import {
  assertBoardAccess,
  assertTicketAccess,
  findTicketIdByDisplayId,
  type TicketAccess,
} from '@/lib/board/board-access'
import { assertBoardAssignee, getBoardMentionCandidates, getTicketMentionCandidates } from '@/lib/board/board-member'
import { assertTagIdsInBoard, syncTicketTags } from '@/lib/board/tag'
import { syncTicketCriteria } from '@/lib/board/ticket-criterion'
import {
  addComment,
  type AddCommentInput,
  changeTicketStatus,
  createTicket,
  type CreateTicketInput,
  deleteComment,
  deleteTicket,
  updateComment,
  updateTicket,
  type UpdateTicketInput,
} from '@/lib/board/ticket-mutation'
import { assertReplyTarget, moveTicketToLane, reassignContentAttachments } from '@/lib/board/ticket-write'
import { ClientError, errInvalidOperation } from '@/lib/error'
import { resolveBoardId } from '@/lib/mcp/mcp-board'
import {
  addTicketCommentForMcp,
  createTicketForMcp,
  deleteTicketCommentForMcp,
  deleteTicketForMcp,
  updateTicketCommentForMcp,
  updateTicketForMcp,
} from '@/lib/mcp/mcp-ticket'
import {
  enqueueTicketCommented,
  enqueueTicketCreated,
  enqueueTicketMoved,
  enqueueTicketUpdated,
} from '@/lib/notify/notify-trigger'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentAuth, oauthAuth, patAuth } from '../../helpers/resource-auth'

const fakeTx = vi.hoisted(() => ({
  ticket: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    aggregate: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  ticketComment: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({}, { tx: fakeTx }))

vi.mock('@/lib/board/board-access', () => ({
  assertBoardAccess: vi.fn(),
  assertTicketAccess: vi.fn(),
  findTicketIdByDisplayId: vi.fn(),
  getAccessibleBoardIds: vi.fn(),
}))

vi.mock('@/lib/board/board-member', () => ({
  assertBoardAssignee: vi.fn(),
  getBoardMentionCandidates: vi.fn(async () => []),
  getTicketMentionCandidates: vi.fn(async () => []),
}))

vi.mock('@/lib/board/ticket-write', () => ({
  assertReplyTarget: vi.fn(),
  moveTicketToLane: vi.fn(),
  nextTicketNumber: vi.fn(async () => 7),
  reassignContentAttachments: vi.fn(),
}))

vi.mock('@/lib/board/tag', () => ({
  assertTagIdsInBoard: vi.fn(async (_tx: unknown, _boardId: string, ids: string[]) => ids),
  syncTicketTags: vi.fn(),
}))

vi.mock('@/lib/board/ticket-criterion', () => ({
  listTicketCriteria: vi.fn(),
  syncTicketCriteria: vi.fn(),
}))

vi.mock('@/lib/agent/agent-auto-revise', () => ({ discardAutoReviseTriggers: vi.fn() }))

vi.mock('@/lib/mcp/mcp-board', () => ({ resolveBoardId: vi.fn(async (id: string) => id) }))

vi.mock('@/lib/notify/notify-trigger', () => ({
  enqueueTicketCommented: vi.fn(),
  enqueueTicketCompletedByMerge: vi.fn(),
  enqueueTicketCreated: vi.fn(),
  enqueueTicketMoved: vi.fn(),
  enqueueTicketUpdated: vi.fn(),
}))

// 表示ID の形式でなければ resolveTicketId はそのまま返すので、UUID 形式の ID を使う
const TICKET_ID = '019eef64-6cc1-78f1-8f50-1ef869860010'
const COMMENT_ID = '019eef64-6cc1-78f1-8f50-1ef869860020'
const AGENT_A = 'agent-a'
const AGENT_B = 'agent-b'
const HUMAN = 'human-1'
const OTHER = 'someone-else'

const MEMBER_X = { id: 'member-x', email: 'x@example.com' }
const MEMBER_Y = { id: 'member-y', email: 'y@example.com' }

type Actor = ResourceAuth['user']

/** 経路ごとの呼び出し口。Web は Server Action が共通関数へ渡す引数と同じ形で呼ぶ */
type Route = {
  via: 'web' | 'mcp'
  actor: Actor
  create: (input: CreateTicketInput) => Promise<unknown>
  update: (id: string, input: UpdateTicketInput) => Promise<unknown>
  remove: (id: string) => Promise<unknown>
  addComment: (input: AddCommentInput) => Promise<unknown>
  updateComment: (id: string, content: string) => Promise<unknown>
  deleteComment: (id: string) => Promise<unknown>
}

const webRoute = (actor: Actor): Route => ({
  via: 'web',
  actor,
  create: (input) => createTicket(actor, input),
  update: (id, input) => updateTicket(actor, id, input),
  remove: (id) => deleteTicket(actor, id),
  addComment: (input) => addComment(actor, input),
  updateComment: (id, content) => updateComment(actor, id, content),
  deleteComment: (id) => deleteComment(actor, id),
})

const mcpRoute = (auth: ResourceAuth): Route => ({
  via: 'mcp',
  actor: auth.user,
  create: (input) => createTicketForMcp(auth, input),
  update: (id, input) => updateTicketForMcp(auth, id, input),
  remove: (id) => deleteTicketForMcp(auth, id),
  addComment: ({ ticketId, content, type, parentId }) =>
    addTicketCommentForMcp(auth, ticketId, content, type, parentId),
  updateComment: (id, content) => updateTicketCommentForMcp(auth, id, content),
  deleteComment: (id) => deleteTicketCommentForMcp(auth, id),
})

const routes: [string, Route][] = [
  ['Web(Server Action)', webRoute(oauthAuth().user)],
  ['MCP(OAuth)', mcpRoute(oauthAuth())],
  ['MCP(個人トークン)', mcpRoute(patAuth())],
  ['MCP(エージェントトークン)', mcpRoute(agentAuth())],
]

const baseAccess: TicketAccess = {
  canView: true,
  canEdit: true,
  canDelete: true,
  canEditAgentMode: false,
  ticketId: TICKET_ID,
  boardId: 'board-1',
  boardKind: 'team',
  createdById: null,
  assigneeId: AGENT_A,
  assigneeIsAgent: true,
  status: 'todo',
  // MCP の追加制限(メンバーは他人担当を更新できない)に掛からないよう、既定はオーナーにする
  boardRole: 'owner',
}

const givenAccess = (overrides: Partial<TicketAccess> = {}) => {
  vi.mocked(assertTicketAccess).mockResolvedValue({ ...baseAccess, ...overrides })
}

/** 権限表の「誰か」を経路の操作者に合わせて実 ID へ置き換える */
type Who = 'self' | 'other' | 'none'
const idOf = (who: Who, actor: Actor): string | null => {
  if (who === 'self') {
    return actor.id
  }
  return who === 'other' ? OTHER : null
}

const createInput = (overrides: Partial<CreateTicketInput> = {}): CreateTicketInput => ({
  boardId: 'board-1',
  title: '新規',
  content: '本文',
  status: 'todo',
  priority: 'medium',
  tagIds: [],
  ...overrides,
})

const ticketUpdateData = () => fakeTx.ticket.update.mock.calls[0][0].data
const ticketCreateData = () => fakeTx.ticket.create.mock.calls[0][0].data

beforeEach(() => {
  vi.clearAllMocks()
  givenAccess()
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
  fakeTx.ticketComment.create.mockResolvedValue({ id: COMMENT_ID })
  vi.mocked(moveTicketToLane).mockResolvedValue({ id: TICKET_ID, status: 'done', order: 0 })
})

describe.each(routes)('createTicket: %s', (_label, route) => {
  it("ボードへの 'write'(アーカイブ済みを拒否)で認可する", async () => {
    await route.create(createInput())

    expect(assertBoardAccess).toHaveBeenCalledWith(route.actor, 'board-1', 'write', fakeTx)
  })

  it('書き込めないボードには作成せず、通知も投入しない', async () => {
    vi.mocked(assertBoardAccess).mockRejectedValue(errInvalidOperation())

    await expect(route.create(createInput())).rejects.toThrow(ClientError)
    expect(fakeTx.ticket.create).not.toHaveBeenCalled()
    expect(enqueueTicketCreated).not.toHaveBeenCalled()
  })

  it('ボードに属さない担当者は作成しない', async () => {
    vi.mocked(assertBoardAssignee).mockRejectedValueOnce(errInvalidOperation())

    await expect(route.create(createInput({ assigneeId: OTHER }))).rejects.toThrow(ClientError)
    expect(assertBoardAssignee).toHaveBeenCalledWith(fakeTx, 'board-1', OTHER)
    expect(fakeTx.ticket.create).not.toHaveBeenCalled()
  })

  it('親を指定せずに子の順番だけを渡すと作成しない', async () => {
    await expect(route.create(createInput({ childOrder: 2 }))).rejects.toThrow(ClientError)
    expect(enqueueTicketCreated).not.toHaveBeenCalled()
  })

  it('ボードに属さないタグは作成しない', async () => {
    vi.mocked(assertTagIdsInBoard).mockRejectedValueOnce(errInvalidOperation())

    await expect(route.create(createInput({ tagIds: ['foreign-tag'] }))).rejects.toThrow(ClientError)
    expect(fakeTx.ticket.create).not.toHaveBeenCalled()
  })

  it('作成者・採番・レーン末尾の順序・タグ・受け入れ条件を保存し、表示ID を返す', async () => {
    fakeTx.ticket.aggregate.mockResolvedValue({ _max: { order: 3 } })

    const result = await route.create(
      createInput({ assigneeId: HUMAN, tagIds: ['tag-1'], criteria: ['条件A', '条件B'], dueDate: '2026-10-01' }),
    )

    expect(result).toEqual({ id: 'new-ticket', title: '新規', displayId: 'TST-7' })
    expect(fakeTx.ticket.aggregate).toHaveBeenCalledWith({
      where: { boardId: 'board-1', status: 'todo' },
      _max: { order: true },
    })
    const data = ticketCreateData()
    expect(data).toMatchObject({
      number: 7,
      boardId: 'board-1',
      createdById: route.actor.id,
      assigneeId: HUMAN,
      completedAt: null,
      dueDate: new Date('2026-10-01T00:00:00Z'),
      tags: { create: [{ tagId: 'tag-1' }] },
      criteria: {
        create: [
          { text: '条件A', order: 0 },
          { text: '条件B', order: 1 },
        ],
      },
    })
    expect(data.order).toBeGreaterThan(3)
  })

  it.each([
    ['未完了', 'todo', null],
    ['完了', 'done', expect.any(Date)],
  ] as const)('%sで作成したときの完了日時', async (_name, status, completedAt) => {
    await route.create(createInput({ status }))

    expect(ticketCreateData()).toMatchObject({ status, completedAt })
  })

  it('担当者を省略すると未割り当て(null)で作成する', async () => {
    await route.create(createInput())

    expect(ticketCreateData()).toMatchObject({ assigneeId: null, dueDate: null })
  })

  it('本文のメンションはボードの候補で解決し、作成通知に渡す', async () => {
    vi.mocked(getBoardMentionCandidates).mockResolvedValue([MEMBER_X, MEMBER_Y])

    await route.create(createInput({ content: `@[${MEMBER_X.email}] と @[unknown@example.com]` }))

    expect(getBoardMentionCandidates).toHaveBeenCalledWith('board-1', fakeTx)
    expect(ticketCreateData()).toMatchObject({ mentionedUserIds: [MEMBER_X.id] })
    expect(enqueueTicketCreated).toHaveBeenCalledWith(
      {
        actorId: route.actor.id,
        ticket: { id: 'new-ticket', boardId: 'board-1', displayId: 'TST-7', title: '新規' },
        assigneeId: null,
        status: 'todo',
        mentionedUserIds: [MEMBER_X.id],
      },
      fakeTx,
    )
  })

  it('本文の添付は作成したチケット自身を除いて付け替える', async () => {
    await route.create(createInput())

    expect(reassignContentAttachments).toHaveBeenCalledWith(fakeTx, '本文', 'board-1', route.actor, 'new-ticket')
  })
})

describe('createTicket: MCP 固有の入力変換', () => {
  it('ボードキーを ID へ解決してから作成する(Web は ID のみを受ける)', async () => {
    vi.mocked(resolveBoardId).mockResolvedValueOnce('board-resolved')
    const auth = oauthAuth()

    await createTicketForMcp(auth, createInput({ boardId: 'TST' }))

    expect(resolveBoardId).toHaveBeenCalledWith('TST')
    expect(assertBoardAccess).toHaveBeenCalledWith(auth.user, 'board-resolved', 'write', fakeTx)
  })

  it('解決できないボードキーではトランザクションに入らない', async () => {
    vi.mocked(resolveBoardId).mockRejectedValueOnce(errInvalidOperation())

    await expect(createTicketForMcp(oauthAuth(), createInput({ boardId: 'NOPE' }))).rejects.toThrow(ClientError)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe.each(routes)('updateTicket: %s', (_label, route) => {
  it("チケットへの 'edit' で認可する", async () => {
    await route.update(TICKET_ID, { title: '変更' })

    expect(assertTicketAccess).toHaveBeenCalledWith(route.actor, TICKET_ID, 'edit', fakeTx)
  })

  it('編集できないチケットは更新せず、通知も投入しない', async () => {
    vi.mocked(assertTicketAccess).mockRejectedValue(errInvalidOperation())

    await expect(route.update(TICKET_ID, { title: '変更' })).rejects.toThrow(ClientError)
    expect(fakeTx.ticket.update).not.toHaveBeenCalled()
    expect(enqueueTicketUpdated).not.toHaveBeenCalled()
  })

  it.each([
    ['人間', HUMAN],
    ['別のエージェント', AGENT_B],
    ['未割り当て', null],
  ])('担当をエージェントから%sへ付け替えると agentMode / agentState を消す', async (_to, assigneeId) => {
    await route.update(TICKET_ID, { assigneeId })

    expect(ticketUpdateData()).toMatchObject({ assigneeId, agentMode: null, agentState: null, agentAutoReviseCount: 0 })
    // 前の担当へ届いていた自動差し戻しのきっかけは捨てる
    expect(discardAutoReviseTriggers).toHaveBeenCalledWith(fakeTx, TICKET_ID)
  })

  it('同じ担当を指定し直しただけなら agentMode / agentState は触らない', async () => {
    await route.update(TICKET_ID, { assigneeId: AGENT_A })

    expect(ticketUpdateData()).not.toHaveProperty('agentMode')
    expect(ticketUpdateData()).not.toHaveProperty('agentState')
  })

  it('担当を指定しない更新では担当・agentMode・期限・メンションは触らない', async () => {
    await route.update(TICKET_ID, { title: '変更後' })

    expect(ticketUpdateData()).toMatchObject({ title: '変更後', mentionedUserIds: undefined })
    expect(ticketUpdateData()).not.toHaveProperty('assigneeId')
    expect(ticketUpdateData()).not.toHaveProperty('agentMode')
    expect(ticketUpdateData()).not.toHaveProperty('dueDate')
    expect(assertBoardAssignee).not.toHaveBeenCalled()
    expect(reassignContentAttachments).not.toHaveBeenCalled()
  })

  it.each([
    ['日付を指定', '2026-10-01', new Date('2026-10-01T00:00:00Z')],
    ['null でクリア', null, null],
  ])('期限を%sすると保存値へ変換する', async (_name, dueDate, expected) => {
    await route.update(TICKET_ID, { dueDate })

    expect(ticketUpdateData()).toMatchObject({ dueDate: expected })
  })

  it('ボードに属さない担当者へは付け替えない', async () => {
    vi.mocked(assertBoardAssignee).mockRejectedValueOnce(errInvalidOperation())

    await expect(route.update(TICKET_ID, { assigneeId: OTHER })).rejects.toThrow(ClientError)
    expect(assertBoardAssignee).toHaveBeenCalledWith(fakeTx, 'board-1', OTHER)
    expect(fakeTx.ticket.update).not.toHaveBeenCalled()
  })

  it('タグを指定したときだけボード内か検証して同期する', async () => {
    await route.update(TICKET_ID, { tagIds: ['tag-1', 'tag-2'] })

    expect(assertTagIdsInBoard).toHaveBeenCalledWith(fakeTx, 'board-1', ['tag-1', 'tag-2'])
    expect(syncTicketTags).toHaveBeenCalledWith(fakeTx, TICKET_ID, ['tag-1', 'tag-2'])
  })

  it('タグ・受け入れ条件を指定しなければ同期しない', async () => {
    await route.update(TICKET_ID, { title: '変更' })

    expect(syncTicketTags).not.toHaveBeenCalled()
    expect(syncTicketCriteria).not.toHaveBeenCalled()
  })

  it('受け入れ条件を指定すると全件置き換える', async () => {
    const criteria = [{ id: 'c1', text: '既存' }, { text: '追加' }]

    await route.update(TICKET_ID, { criteria })

    expect(syncTicketCriteria).toHaveBeenCalledWith(fakeTx, TICKET_ID, criteria)
  })

  it('本文を書き換えるとメンションを解き直し、増えた相手だけを通知する', async () => {
    fakeTx.ticket.findUniqueOrThrow.mockResolvedValue({ mentionedUserIds: [MEMBER_X.id] })
    vi.mocked(getTicketMentionCandidates).mockResolvedValue([MEMBER_X, MEMBER_Y])

    await route.update(TICKET_ID, { content: `@[${MEMBER_X.email}] @[${MEMBER_Y.email}]` })

    expect(ticketUpdateData()).toMatchObject({ mentionedUserIds: [MEMBER_X.id, MEMBER_Y.id] })
    expect(enqueueTicketUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ addedMentionUserIds: [MEMBER_Y.id] }),
      fakeTx,
    )
  })

  it('本文の添付をチケットのボードへ付け替える', async () => {
    await route.update(TICKET_ID, { content: '本文' })

    expect(reassignContentAttachments).toHaveBeenCalledWith(fakeTx, '本文', 'board-1', route.actor, TICKET_ID)
  })

  it('担当の変更を通知に渡す', async () => {
    await route.update(TICKET_ID, { assigneeId: HUMAN })

    expect(enqueueTicketUpdated).toHaveBeenCalledWith(
      {
        actorId: route.actor.id,
        ticket: { id: TICKET_ID, boardId: 'board-1', displayId: 'TST-1', title: 'チケット' },
        before: { assigneeId: AGENT_A, status: 'todo' },
        after: { assigneeId: HUMAN, status: 'todo' },
        addedMentionUserIds: [],
      },
      fakeTx,
    )
  })

  it('status を指定するとレーンを移し、移動後のステータスを返して通知に渡す', async () => {
    const result = await route.update(TICKET_ID, { status: 'done' })

    expect(moveTicketToLane).toHaveBeenCalledWith(fakeTx, { access: baseAccess, status: 'done' })
    expect(result).toEqual({ id: TICKET_ID, title: 'チケット', displayId: 'TST-1', status: 'done' })
    expect(enqueueTicketUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ after: { assigneeId: AGENT_A, status: 'done' } }),
      fakeTx,
    )
  })

  it('同じ status ならレーンは動かさない', async () => {
    await route.update(TICKET_ID, { status: 'todo' })

    expect(moveTicketToLane).not.toHaveBeenCalled()
  })
})

/**
 * [ボードでのロール, 現在の担当, Web で更新できるか, MCP で更新できるか]
 * assertTicketAccess('edit') を通った後に、MCP だけが canMcpUpdateTicket で絞る
 */
const updatePermissionTable: ['owner' | 'member', Who, boolean, boolean][] = [
  ['owner', 'self', true, true],
  ['owner', 'other', true, true],
  ['owner', 'none', true, true],
  ['member', 'self', true, true],
  ['member', 'other', true, false],
  ['member', 'none', true, true],
]

describe.each(routes)('updateTicket の権限表: %s', (_label, route) => {
  it.each(updatePermissionTable)(
    'ロール %s・担当 %s のチケット(Web: %s / MCP: %s)',
    async (boardRole, assignee, web, mcp) => {
      givenAccess({ boardRole, assigneeId: idOf(assignee, route.actor), assigneeIsAgent: false })
      const allowed = route.via === 'web' ? web : mcp

      const result = route.update(TICKET_ID, { title: '変更' })

      if (allowed) {
        await expect(result).resolves.toMatchObject({ id: TICKET_ID })
        expect(fakeTx.ticket.update).toHaveBeenCalled()
      } else {
        await expect(result).rejects.toThrow(ClientError)
        expect(fakeTx.ticket.update).not.toHaveBeenCalled()
        expect(fakeTx.ticket.findUniqueOrThrow).not.toHaveBeenCalled()
        expect(enqueueTicketUpdated).not.toHaveBeenCalled()
      }
    },
  )

  it('担当の付け替えでは、変更前の担当で判定する', async () => {
    givenAccess({ boardRole: 'member', assigneeId: OTHER, assigneeIsAgent: false })

    const result = route.update(TICKET_ID, { assigneeId: route.actor.id })

    if (route.via === 'web') {
      await expect(result).resolves.toMatchObject({ id: TICKET_ID })
    } else {
      await expect(result).rejects.toThrow(ClientError)
      expect(assertBoardAssignee).not.toHaveBeenCalled()
    }
  })
})

describe.each(routes)('deleteTicket: %s', (_label, route) => {
  it("チケットへの 'delete' で認可する", async () => {
    givenAccess({ createdById: route.actor.id })

    await expect(route.remove(TICKET_ID)).resolves.toEqual({ id: TICKET_ID })
    expect(assertTicketAccess).toHaveBeenCalledWith(route.actor, TICKET_ID, 'delete', fakeTx)
    expect(fakeTx.ticket.delete).toHaveBeenCalledWith({ where: { id: TICKET_ID } })
  })

  it('削除できないチケットは削除しない', async () => {
    vi.mocked(assertTicketAccess).mockRejectedValue(errInvalidOperation())

    await expect(route.remove(TICKET_ID)).rejects.toThrow(ClientError)
    expect(fakeTx.ticket.delete).not.toHaveBeenCalled()
  })
})

/**
 * [ボードでのロール, 作成者, Web で削除できるか, MCP で削除できるか]
 * assertTicketAccess('delete')(owner または作成者)を通った後に、MCP だけが canMcpDeleteTicket で作成者に絞る
 */
const deletePermissionTable: ['owner' | 'member', Who, boolean, boolean][] = [
  ['owner', 'self', true, true],
  ['owner', 'other', true, false],
  ['owner', 'none', true, false],
  ['member', 'self', true, true],
]

describe.each(routes)('deleteTicket の権限表: %s', (_label, route) => {
  it.each(deletePermissionTable)(
    'ロール %s・作成者 %s のチケット(Web: %s / MCP: %s)',
    async (boardRole, creator, web, mcp) => {
      givenAccess({ boardRole, createdById: idOf(creator, route.actor) })
      const allowed = route.via === 'web' ? web : mcp

      const result = route.remove(TICKET_ID)

      if (allowed) {
        await expect(result).resolves.toEqual({ id: TICKET_ID })
        expect(fakeTx.ticket.delete).toHaveBeenCalledWith({ where: { id: TICKET_ID } })
      } else {
        await expect(result).rejects.toThrow(ClientError)
        expect(fakeTx.ticket.delete).not.toHaveBeenCalled()
      }
    },
  )
})

describe.each(routes)('コメント投稿: %s', (_label, route) => {
  it("チケットへの 'edit' で認可し、本文・種別を投稿者つきで保存する", async () => {
    await expect(route.addComment({ ticketId: TICKET_ID, content: '報告', type: 'report' })).resolves.toMatchObject({
      id: COMMENT_ID,
    })

    expect(assertTicketAccess).toHaveBeenCalledWith(route.actor, TICKET_ID, 'edit', fakeTx)
    expect(fakeTx.ticketComment.create).toHaveBeenCalledWith({
      data: {
        ticketId: TICKET_ID,
        authorId: route.actor.id,
        content: '報告',
        type: 'report',
        parentId: undefined,
        decision: undefined,
        mentionedUserIds: [],
      },
      select: { id: true },
    })
    expect(assertReplyTarget).not.toHaveBeenCalled()
  })

  it('返信のときは返信先がそのチケットの親コメントか検証する', async () => {
    await route.addComment({ ticketId: TICKET_ID, content: '返信', parentId: 'parent-1' })

    expect(assertReplyTarget).toHaveBeenCalledWith(fakeTx, TICKET_ID, 'parent-1')
    expect(fakeTx.ticketComment.create.mock.calls[0][0].data).toMatchObject({ parentId: 'parent-1' })
  })

  it('返信先が不正なら投稿しない', async () => {
    vi.mocked(assertReplyTarget).mockRejectedValueOnce(errInvalidOperation())

    await expect(route.addComment({ ticketId: TICKET_ID, content: '返信', parentId: 'bad' })).rejects.toThrow(
      ClientError,
    )
    expect(fakeTx.ticketComment.create).not.toHaveBeenCalled()
  })

  it('編集できないチケットには投稿しない', async () => {
    vi.mocked(assertTicketAccess).mockRejectedValue(errInvalidOperation())

    await expect(route.addComment({ ticketId: TICKET_ID, content: 'x' })).rejects.toThrow(ClientError)
    expect(fakeTx.ticketComment.create).not.toHaveBeenCalled()
    expect(enqueueTicketCommented).not.toHaveBeenCalled()
  })

  it('担当が他人でも投稿できる(MCP でも更新の追加制限は掛からない)', async () => {
    givenAccess({ boardRole: 'member', assigneeId: OTHER, createdById: OTHER })

    await expect(route.addComment({ ticketId: TICKET_ID, content: 'x' })).resolves.toMatchObject({ id: COMMENT_ID })
  })

  it('メンションを解決し、チケットの updatedAt を更新して通知に渡す', async () => {
    vi.mocked(getTicketMentionCandidates).mockResolvedValue([MEMBER_X, MEMBER_Y])
    const content = `@[${MEMBER_Y.email}] 確認お願いします`

    await route.addComment({ ticketId: TICKET_ID, content })

    expect(reassignContentAttachments).toHaveBeenCalledWith(fakeTx, content, 'board-1', route.actor, TICKET_ID)
    expect(fakeTx.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TICKET_ID }, data: { updatedAt: expect.any(Date) } }),
    )
    expect(enqueueTicketCommented).toHaveBeenCalledWith(
      {
        actorId: route.actor.id,
        ticket: { id: TICKET_ID, boardId: 'board-1', displayId: 'TST-1', title: 'チケット' },
        comment: { id: COMMENT_ID, content },
        addedMentionUserIds: [MEMBER_Y.id],
      },
      fakeTx,
    )
  })
})

describe.each(routes)('コメント更新: %s', (_label, route) => {
  const target = (authorId: string, mentionedUserIds: string[] = []) => ({
    ticketId: TICKET_ID,
    authorId,
    mentionedUserIds,
    ticket: { number: 1, title: 'チケット', board: { key: 'TST' } },
  })

  it("投稿者本人ならチケットへの 'edit' で認可して更新する", async () => {
    fakeTx.ticketComment.findUnique.mockResolvedValue(target(route.actor.id))

    await expect(route.updateComment(COMMENT_ID, '修正')).resolves.toMatchObject({ id: COMMENT_ID })

    expect(assertTicketAccess).toHaveBeenCalledWith(route.actor, TICKET_ID, 'edit', fakeTx)
    expect(fakeTx.ticketComment.update).toHaveBeenCalledWith({
      where: { id: COMMENT_ID },
      data: { content: '修正', mentionedUserIds: [] },
    })
    expect(fakeTx.ticket.update).toHaveBeenCalledWith({
      where: { id: TICKET_ID },
      data: { updatedAt: expect.any(Date) },
    })
  })

  it.each([
    ['他人のコメント', () => target(OTHER)],
    ['存在しないコメント', () => null],
  ])('%sは更新しない', async (_name, found) => {
    fakeTx.ticketComment.findUnique.mockResolvedValue(found())

    await expect(route.updateComment(COMMENT_ID, '修正')).rejects.toThrow(ClientError)
    expect(assertTicketAccess).not.toHaveBeenCalled()
    expect(fakeTx.ticketComment.update).not.toHaveBeenCalled()
  })

  it('投稿者本人でもチケットを編集できなければ更新しない', async () => {
    fakeTx.ticketComment.findUnique.mockResolvedValue(target(route.actor.id))
    vi.mocked(assertTicketAccess).mockRejectedValue(errInvalidOperation())

    await expect(route.updateComment(COMMENT_ID, '修正')).rejects.toThrow(ClientError)
    expect(fakeTx.ticketComment.update).not.toHaveBeenCalled()
  })

  it('メンションは増えた相手だけを通知する', async () => {
    fakeTx.ticketComment.findUnique.mockResolvedValue(target(route.actor.id, [MEMBER_X.id]))
    vi.mocked(getTicketMentionCandidates).mockResolvedValue([MEMBER_X, MEMBER_Y])

    await route.updateComment(COMMENT_ID, `@[${MEMBER_X.email}] @[${MEMBER_Y.email}]`)

    expect(fakeTx.ticketComment.update.mock.calls[0][0].data).toMatchObject({
      mentionedUserIds: [MEMBER_X.id, MEMBER_Y.id],
    })
    expect(enqueueTicketCommented).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket: { id: TICKET_ID, boardId: 'board-1', displayId: 'TST-1', title: 'チケット' },
        addedMentionUserIds: [MEMBER_Y.id],
      }),
      fakeTx,
    )
  })
})

/**
 * [投稿者, チケットを削除できる権限(canDelete), 削除できるか]
 * チケット削除と違い MCP 固有の追加制限は無いので、全経路で同じ期待値になる
 */
const deleteCommentTable: [Who, boolean, boolean][] = [
  ['self', false, true],
  ['self', true, true],
  ['other', true, true],
  ['other', false, false],
]

describe.each(routes)('コメント削除: %s', (_label, route) => {
  it.each(deleteCommentTable)(
    '投稿者 %s・canDelete %s のコメント(削除できる: %s)',
    async (author, canDelete, allowed) => {
      fakeTx.ticketComment.findUnique.mockResolvedValue({ ticketId: TICKET_ID, authorId: idOf(author, route.actor) })
      givenAccess({ canDelete })

      const result = route.deleteComment(COMMENT_ID)

      if (allowed) {
        await expect(result).resolves.toEqual({ id: COMMENT_ID })
        expect(fakeTx.ticketComment.delete).toHaveBeenCalledWith({ where: { id: COMMENT_ID } })
      } else {
        await expect(result).rejects.toThrow(ClientError)
        expect(fakeTx.ticketComment.delete).not.toHaveBeenCalled()
      }
    },
  )

  it("チケットへの 'edit' で認可する", async () => {
    fakeTx.ticketComment.findUnique.mockResolvedValue({ ticketId: TICKET_ID, authorId: route.actor.id })

    await route.deleteComment(COMMENT_ID)

    expect(assertTicketAccess).toHaveBeenCalledWith(route.actor, TICKET_ID, 'edit', fakeTx)
  })

  it('存在しないコメントは削除しない', async () => {
    fakeTx.ticketComment.findUnique.mockResolvedValue(null)

    await expect(route.deleteComment(COMMENT_ID)).rejects.toThrow(ClientError)
    expect(assertTicketAccess).not.toHaveBeenCalled()
    expect(fakeTx.ticketComment.delete).not.toHaveBeenCalled()
  })

  it('作成者でないチケット上のコメントでも、canDelete があれば削除できる(チケット削除の MCP 制限は掛からない)', async () => {
    fakeTx.ticketComment.findUnique.mockResolvedValue({ ticketId: TICKET_ID, authorId: OTHER })
    givenAccess({ createdById: OTHER, canDelete: true })

    await expect(route.deleteComment(COMMENT_ID)).resolves.toEqual({ id: COMMENT_ID })
  })
})

describe('MCP 固有: 表示ID でのチケット指定', () => {
  const auth = oauthAuth()
  const operations: [string, (ticketId: string) => Promise<unknown>][] = [
    ['更新', (ticketId) => updateTicketForMcp(auth, ticketId, { title: '変更' })],
    ['削除', (ticketId) => deleteTicketForMcp(auth, ticketId)],
    ['コメント投稿', (ticketId) => addTicketCommentForMcp(auth, ticketId, 'x')],
  ]

  it.each(operations)('%s: 表示ID を内部 ID へ解決してから認可する', async (_name, run) => {
    vi.mocked(findTicketIdByDisplayId).mockResolvedValue(TICKET_ID)
    givenAccess({ createdById: auth.user.id })

    await run('TST-1')

    expect(findTicketIdByDisplayId).toHaveBeenCalledWith(auth.user, 'TST-1')
    expect(assertTicketAccess).toHaveBeenCalledWith(auth.user, TICKET_ID, expect.any(String), fakeTx)
  })

  it.each(operations)('%s: 見つからない表示ID ではトランザクションに入らない', async (_name, run) => {
    vi.mocked(findTicketIdByDisplayId).mockResolvedValue(null)

    await expect(run('TST-999')).rejects.toThrow(ClientError)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each(operations)('%s: 内部 ID はそのまま使い、表示ID の検索をしない', async (_name, run) => {
    givenAccess({ createdById: auth.user.id })

    await run(TICKET_ID)

    expect(findTicketIdByDisplayId).not.toHaveBeenCalled()
  })
})

describe('経路で共通化していない操作', () => {
  it('ステータス変更(かんばん / 詳細画面)は移動通知を投入し、更新通知は出さない', async () => {
    const actor = oauthAuth().user

    await changeTicketStatus(actor, TICKET_ID, 'done', 0)

    expect(assertTicketAccess).toHaveBeenCalledWith(actor, TICKET_ID, 'edit', fakeTx)
    expect(moveTicketToLane).toHaveBeenCalledWith(fakeTx, { access: baseAccess, status: 'done', index: 0 })
    expect(enqueueTicketMoved).toHaveBeenCalledWith(
      { actorId: actor.id, ticketId: TICKET_ID, before: 'todo', after: 'done' },
      fakeTx,
    )
    expect(enqueueTicketUpdated).not.toHaveBeenCalled()
  })
})
