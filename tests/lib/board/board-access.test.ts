/**
 * ボード / チケットの認可判定(board-access.ts)
 *
 * ボードのメンバーでない承認者の表示ID解決と添付配信は board-approver-access.test.ts で見る。
 */

import { approvableAgentWhere } from '@/lib/agent/agent-approver'
import {
  assertBoardAccess,
  assertTeamBoard,
  assertTicketAccess,
  canViewAttachment,
  findTicketIdByDisplayId,
  getAccessibleBoardIds,
  getBoardAccess,
  getTicketAccess,
} from '@/lib/board/board-access'
import { boardVisibleWhere } from '@/lib/board/ticket-permission'
import { ClientError } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    board: ['findUnique', 'findMany'],
    ticket: ['findUnique', 'count'],
    user: ['count'],
  }),
)

type FindArgs = { where: Record<string, unknown>; select?: Record<string, unknown> }

type BoardFixture = {
  kind?: 'team' | 'private'
  archived?: boolean
  /** 直接メンバー(BoardMember)としてのロール */
  memberRole?: 'owner' | 'member' | null
  /** グループ経由(BoardGroup)で入れるか */
  viaGroup?: boolean
}

type TicketFixture = {
  createdById?: string | null
  assigneeId?: string | null
  assigneeIsAgent?: boolean
}

const BOARD_ID = 'b1'
const TICKET_ID = 't1'
const user = { id: 'u1', role: 'user' }
const admin = { id: 'u1', role: 'admin' }

/** ボード `ABC`(b1)。null ならボードが存在しない */
const mockBoard = (fixture: BoardFixture | null) => {
  vi.mocked(prisma.board.findUnique).mockImplementation((async ({ where, select }: FindArgs) => {
    if (!fixture) {
      return null
    }
    const { kind = 'team', archived = false, memberRole = null, viaGroup = false } = fixture
    if (where.key) {
      return where.key === 'ABC' ? { id: BOARD_ID } : null
    }
    if (select?.members) {
      return {
        id: BOARD_ID,
        kind,
        archived,
        members: memberRole ? [{ role: memberRole }] : [],
        groups: viaGroup ? [{ id: 'bg1' }] : [],
      }
    }
    return { kind, archived }
  }) as never)
}

/** チケット t1(ボード b1 の 1 番)。null ならチケットが存在しない */
const mockTicket = (fixture: TicketFixture | null) => {
  vi.mocked(prisma.ticket.findUnique).mockImplementation((async ({ where }: FindArgs) => {
    if (!fixture) {
      return null
    }
    if (where.boardId_number) {
      return { id: TICKET_ID }
    }
    const { createdById = 'u2', assigneeId = null, assigneeIsAgent = false } = fixture
    return {
      id: TICKET_ID,
      boardId: BOARD_ID,
      createdById,
      assigneeId,
      status: 'todo',
      assignee: assigneeId ? { isAgent: assigneeIsAgent } : null,
    }
  }) as never)
}

const agentTicket: TicketFixture = { assigneeId: 'agent-1', assigneeIsAgent: true }

const mockApprover = (approver: boolean) => {
  vi.mocked(prisma.user.count).mockResolvedValue(approver ? 1 : 0)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertTeamBoard', () => {
  it('チームボードなら通す', async () => {
    mockBoard({ kind: 'team' })
    await expect(assertTeamBoard(prisma, BOARD_ID)).resolves.toBeUndefined()
  })

  it('プライベートボードは管理者であっても構成を変えさせない', async () => {
    mockBoard({ kind: 'private' })
    await expect(assertTeamBoard(prisma, BOARD_ID)).rejects.toThrow(ClientError)
  })

  it('ボードが存在しなければ拒否する', async () => {
    mockBoard(null)
    await expect(assertTeamBoard(prisma, BOARD_ID)).rejects.toThrow(ClientError)
  })
})

describe('getBoardAccess', () => {
  it('ボードが存在しなければ null', async () => {
    mockBoard(null)
    expect(await getBoardAccess(user, BOARD_ID)).toBeNull()
  })

  it('直接メンバーの owner は owner / member 経由', async () => {
    mockBoard({ memberRole: 'owner' })
    expect(await getBoardAccess(user, BOARD_ID)).toEqual({
      boardId: BOARD_ID,
      kind: 'team',
      role: 'owner',
      via: 'member',
      archived: false,
    })
  })

  it('グループ経由だけなら member / group 経由', async () => {
    mockBoard({ viaGroup: true })
    expect(await getBoardAccess(user, BOARD_ID)).toMatchObject({ role: 'member', via: 'group' })
  })

  it('直接メンバーとグループ経由の両方なら直接のロールを優先する', async () => {
    mockBoard({ memberRole: 'owner', viaGroup: true })
    expect(await getBoardAccess(user, BOARD_ID)).toMatchObject({ role: 'owner', via: 'member' })
  })

  it('直接メンバーでもグループ経由でもなければ null', async () => {
    mockBoard({})
    expect(await getBoardAccess(user, BOARD_ID)).toBeNull()
  })

  it('管理者でもアサインされていなければ null(中身は見せない)', async () => {
    mockBoard({})
    expect(await getBoardAccess(admin, BOARD_ID)).toBeNull()
  })

  it('アーカイブ済み・プライベートの属性をそのまま返す', async () => {
    mockBoard({ kind: 'private', archived: true, memberRole: 'owner' })
    expect(await getBoardAccess(user, BOARD_ID)).toMatchObject({ kind: 'private', archived: true })
  })

  it('メンバーとグループは操作者本人で絞り込む', async () => {
    mockBoard({ memberRole: 'member' })
    await getBoardAccess(user, BOARD_ID)
    expect(prisma.board.findUnique).toHaveBeenCalledWith({
      where: { id: BOARD_ID },
      select: {
        id: true,
        kind: true,
        archived: true,
        members: { where: { userId: 'u1' }, select: { role: true }, take: 1 },
        groups: {
          where: { group: { userGroups: { some: { userId: 'u1' } } } },
          select: { id: true },
          take: 1,
        },
      },
    })
  })

  it('tx を渡せばそちらで引く', async () => {
    const tx = { board: { findUnique: vi.fn().mockResolvedValue(null) } }
    await getBoardAccess(user, BOARD_ID, tx as never)
    expect(tx.board.findUnique).toHaveBeenCalled()
    expect(prisma.board.findUnique).not.toHaveBeenCalled()
  })
})

describe('assertBoardAccess', () => {
  it('view はグループ経由のメンバーでも通す', async () => {
    mockBoard({ viaGroup: true })
    await expect(assertBoardAccess(user, BOARD_ID, 'view')).resolves.toMatchObject({ via: 'group' })
  })

  it('view は非メンバーを拒否する', async () => {
    mockBoard({})
    await expect(assertBoardAccess(user, BOARD_ID, 'view')).rejects.toThrow(ClientError)
  })

  it('view はボードが存在しなければ拒否する', async () => {
    mockBoard(null)
    await expect(assertBoardAccess(user, BOARD_ID, 'view')).rejects.toThrow(ClientError)
  })

  it('manage は owner なら通す', async () => {
    mockBoard({ memberRole: 'owner' })
    await expect(assertBoardAccess(user, BOARD_ID, 'manage')).resolves.toMatchObject({ role: 'owner' })
  })

  it('manage は member を拒否する', async () => {
    mockBoard({ memberRole: 'member' })
    await expect(assertBoardAccess(user, BOARD_ID, 'manage')).rejects.toThrow(ClientError)
  })

  it('manage はグループ経由のメンバーを拒否する', async () => {
    mockBoard({ viaGroup: true })
    await expect(assertBoardAccess(user, BOARD_ID, 'manage')).rejects.toThrow(ClientError)
  })

  it('manage は管理者なら member ロールでも通し、ロールは実態のまま返す', async () => {
    mockBoard({ memberRole: 'member' })
    await expect(assertBoardAccess(admin, BOARD_ID, 'manage')).resolves.toMatchObject({
      role: 'member',
      via: 'member',
    })
  })

  it('manage は管理者ならアサインされていないボードでも owner 扱いで通す', async () => {
    mockBoard({ archived: true })
    await expect(assertBoardAccess(admin, BOARD_ID, 'manage')).resolves.toEqual({
      boardId: BOARD_ID,
      kind: 'team',
      role: 'owner',
      via: 'member',
      archived: true,
    })
  })

  it('manage は管理者でもボードが存在しなければ拒否する', async () => {
    mockBoard(null)
    await expect(assertBoardAccess(admin, BOARD_ID, 'manage')).rejects.toThrow(ClientError)
  })

  it('manage はアーカイブ済みでも owner なら通す(アーカイブの解除に使う)', async () => {
    mockBoard({ memberRole: 'owner', archived: true })
    await expect(assertBoardAccess(user, BOARD_ID, 'manage')).resolves.toMatchObject({ archived: true })
  })

  it('非メンバーの一般ユーザーの manage はボードを引き直さずに拒否する', async () => {
    mockBoard({})
    await expect(assertBoardAccess(user, BOARD_ID, 'manage')).rejects.toThrow(ClientError)
    expect(prisma.board.findUnique).toHaveBeenCalledTimes(1)
  })

  it('管理者特権は manage だけで、アサインされていなければ view / write は拒否する', async () => {
    mockBoard({})
    await expect(assertBoardAccess(admin, BOARD_ID, 'view')).rejects.toThrow(ClientError)
    await expect(assertBoardAccess(admin, BOARD_ID, 'write')).rejects.toThrow(ClientError)
  })

  it('write はグループ経由のメンバーでも未アーカイブなら通す', async () => {
    mockBoard({ viaGroup: true })
    await expect(assertBoardAccess(user, BOARD_ID, 'write')).resolves.toMatchObject({ via: 'group' })
  })
})

describe('getAccessibleBoardIds', () => {
  it('既定ではアーカイブ済みを除き、ID だけを返す', async () => {
    vi.mocked(prisma.board.findMany).mockResolvedValue([{ id: 'b1' }, { id: 'b2' }] as never)
    expect(await getAccessibleBoardIds('u1')).toEqual(['b1', 'b2'])
    expect(prisma.board.findMany).toHaveBeenCalledWith({
      where: { archived: false, ...boardVisibleWhere('u1') },
      select: { id: true },
    })
  })

  it('includeArchived ならアーカイブ済みも含める', async () => {
    vi.mocked(prisma.board.findMany).mockResolvedValue([] as never)
    expect(await getAccessibleBoardIds('u1', { includeArchived: true })).toEqual([])
    expect(prisma.board.findMany).toHaveBeenCalledWith({
      where: boardVisibleWhere('u1'),
      select: { id: true },
    })
  })
})

describe('getTicketAccess', () => {
  it('チケットが存在しなければ null で、ボードは引かない', async () => {
    mockTicket(null)
    expect(await getTicketAccess(user, TICKET_ID)).toBeNull()
    expect(prisma.board.findUnique).not.toHaveBeenCalled()
  })

  it('ボードが存在しなければ null', async () => {
    mockTicket({})
    mockBoard(null)
    expect(await getTicketAccess(user, TICKET_ID)).toBeNull()
  })

  it('直接メンバーの member は閲覧・編集でき、他人のチケットは削除できない', async () => {
    mockTicket({})
    mockBoard({ memberRole: 'member' })
    expect(await getTicketAccess(user, TICKET_ID)).toEqual({
      ticketId: TICKET_ID,
      boardId: BOARD_ID,
      createdById: 'u2',
      assigneeId: null,
      status: 'todo',
      assigneeIsAgent: false,
      boardKind: 'team',
      boardRole: 'member',
      canView: true,
      canEdit: true,
      canDelete: false,
      canEditAgentMode: false,
    })
  })

  it('member でも自分が作成したチケットは削除できる', async () => {
    mockTicket({ createdById: 'u1' })
    mockBoard({ memberRole: 'member' })
    expect(await getTicketAccess(user, TICKET_ID)).toMatchObject({ canDelete: true })
  })

  it('owner は他人のチケットも削除できる', async () => {
    mockTicket({})
    mockBoard({ memberRole: 'owner' })
    expect(await getTicketAccess(user, TICKET_ID)).toMatchObject({ boardRole: 'owner', canDelete: true })
  })

  it('グループ経由のメンバーは member と同じ権限になる', async () => {
    mockTicket({})
    mockBoard({ viaGroup: true })
    expect(await getTicketAccess(user, TICKET_ID)).toMatchObject({
      boardRole: 'member',
      canView: true,
      canEdit: true,
      canDelete: false,
    })
  })

  it('アーカイブ済みボードでは owner でも閲覧のみ', async () => {
    mockTicket({ createdById: 'u1' })
    mockBoard({ memberRole: 'owner', archived: true })
    expect(await getTicketAccess(user, TICKET_ID)).toMatchObject({
      canView: true,
      canEdit: false,
      canDelete: false,
    })
  })

  it('プライベートボードの持ち主は全操作でき、boardKind を private で返す', async () => {
    mockTicket({ createdById: 'u1' })
    mockBoard({ kind: 'private', memberRole: 'owner' })
    expect(await getTicketAccess(user, TICKET_ID)).toMatchObject({
      boardKind: 'private',
      canView: true,
      canEdit: true,
      canDelete: true,
    })
  })

  it('非メンバーは null ではなく権限なしを返し、boardKind は引き直したボードから埋める', async () => {
    mockTicket({})
    mockBoard({ kind: 'private' })
    expect(await getTicketAccess(user, TICKET_ID)).toMatchObject({
      boardKind: 'private',
      boardRole: null,
      canView: false,
      canEdit: false,
      canDelete: false,
      canEditAgentMode: false,
    })
    expect(prisma.board.findUnique).toHaveBeenLastCalledWith({
      where: { id: BOARD_ID },
      select: { kind: true, archived: true },
    })
  })

  it('管理者でも非メンバーなら閲覧できない', async () => {
    mockTicket({})
    mockBoard({})
    expect(await getTicketAccess(admin, TICKET_ID)).toMatchObject({ canView: false, canEdit: false })
  })

  it('担当が人間なら承認者を問い合わせない', async () => {
    mockTicket({ assigneeId: 'u3', assigneeIsAgent: false })
    mockBoard({ memberRole: 'member' })
    expect(await getTicketAccess(user, TICKET_ID)).toMatchObject({ assigneeIsAgent: false, canEditAgentMode: false })
    expect(prisma.user.count).not.toHaveBeenCalled()
  })

  it('未割り当てなら承認者を問い合わせない', async () => {
    mockTicket({})
    mockBoard({ memberRole: 'owner' })
    await getTicketAccess(user, TICKET_ID)
    expect(prisma.user.count).not.toHaveBeenCalled()
  })

  it('担当エージェントの承認者は、操作者と担当で問い合わせる', async () => {
    mockTicket(agentTicket)
    mockBoard({ memberRole: 'member' })
    mockApprover(true)
    await getTicketAccess(user, TICKET_ID)
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { id: 'agent-1', ...approvableAgentWhere('u1') } })
  })

  it('メンバーかつ承認者ならエージェントモードも変更できる', async () => {
    mockTicket(agentTicket)
    mockBoard({ memberRole: 'member' })
    mockApprover(true)
    expect(await getTicketAccess(user, TICKET_ID)).toMatchObject({
      assigneeIsAgent: true,
      canView: true,
      canEdit: true,
      canEditAgentMode: true,
    })
  })

  it('owner でも承認者でなければエージェントモードは変更できない', async () => {
    mockTicket(agentTicket)
    mockBoard({ memberRole: 'owner' })
    mockApprover(false)
    expect(await getTicketAccess(user, TICKET_ID)).toMatchObject({ canEdit: true, canEditAgentMode: false })
  })

  it('非メンバーの承認者は閲覧とエージェントモードの変更だけできる', async () => {
    mockTicket(agentTicket)
    mockBoard({})
    mockApprover(true)
    expect(await getTicketAccess(user, TICKET_ID)).toMatchObject({
      boardRole: null,
      canView: true,
      canEdit: false,
      canDelete: false,
      canEditAgentMode: true,
    })
  })

  it('アーカイブ済みボードでは承認者でもエージェントモードを変更できない', async () => {
    mockTicket(agentTicket)
    mockBoard({ archived: true })
    mockApprover(true)
    expect(await getTicketAccess(user, TICKET_ID)).toMatchObject({ canView: true, canEditAgentMode: false })
  })

  it('tx を渡せばチケット・ボード・承認者のすべてをそちらで引く', async () => {
    const tx = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue({
          id: TICKET_ID,
          boardId: BOARD_ID,
          createdById: 'u2',
          assigneeId: 'agent-1',
          status: 'todo',
          assignee: { isAgent: true },
        }),
      },
      board: { findUnique: vi.fn().mockResolvedValue({ kind: 'team', archived: false, members: [], groups: [] }) },
      user: { count: vi.fn().mockResolvedValue(1) },
    }
    expect(await getTicketAccess(user, TICKET_ID, tx as never)).toMatchObject({ canView: true })
    expect(tx.user.count).toHaveBeenCalled()
    expect(prisma.ticket.findUnique).not.toHaveBeenCalled()
    expect(prisma.board.findUnique).not.toHaveBeenCalled()
    expect(prisma.user.count).not.toHaveBeenCalled()
  })
})

describe('assertTicketAccess', () => {
  it('チケットが存在しなければ拒否する', async () => {
    mockTicket(null)
    await expect(assertTicketAccess(user, TICKET_ID, 'view')).rejects.toThrow(ClientError)
  })

  it('view はメンバーなら通し、アクセス実体を返す', async () => {
    mockTicket({})
    mockBoard({ viaGroup: true })
    await expect(assertTicketAccess(user, TICKET_ID, 'view')).resolves.toMatchObject({
      ticketId: TICKET_ID,
      boardRole: 'member',
    })
  })

  it('view は非メンバーを拒否する', async () => {
    mockTicket({})
    mockBoard({})
    await expect(assertTicketAccess(user, TICKET_ID, 'view')).rejects.toThrow(ClientError)
  })

  it('edit はアーカイブ済みボードを拒否する', async () => {
    mockTicket({})
    mockBoard({ memberRole: 'owner', archived: true })
    await expect(assertTicketAccess(user, TICKET_ID, 'edit')).rejects.toThrow(ClientError)
  })

  it('delete は他人のチケットの member を拒否し、owner なら通す', async () => {
    mockTicket({})
    mockBoard({ memberRole: 'member' })
    await expect(assertTicketAccess(user, TICKET_ID, 'delete')).rejects.toThrow(ClientError)

    mockBoard({ memberRole: 'owner' })
    await expect(assertTicketAccess(user, TICKET_ID, 'delete')).resolves.toMatchObject({ canDelete: true })
  })

  it('agentMode は承認者でなければ owner でも拒否する', async () => {
    mockTicket(agentTicket)
    mockBoard({ memberRole: 'owner' })
    mockApprover(false)
    await expect(assertTicketAccess(user, TICKET_ID, 'agentMode')).rejects.toThrow(ClientError)
  })

  it('非メンバーの承認者は agentMode を通し、edit は拒否する', async () => {
    mockTicket(agentTicket)
    mockBoard({})
    mockApprover(true)
    await expect(assertTicketAccess(user, TICKET_ID, 'agentMode')).resolves.toMatchObject({
      canEditAgentMode: true,
    })
    await expect(assertTicketAccess(user, TICKET_ID, 'edit')).rejects.toThrow(ClientError)
  })
})

describe('findTicketIdByDisplayId', () => {
  it('表示IDの形式でなければ DB を引かずに null', async () => {
    expect(await findTicketIdByDisplayId(user, 'ABC')).toBeNull()
    expect(prisma.board.findUnique).not.toHaveBeenCalled()
  })

  it('キーは大文字に揃え、ボードと番号でチケットを引く', async () => {
    mockBoard({ memberRole: 'member' })
    mockTicket({})
    expect(await findTicketIdByDisplayId(user, ' abc-12 ')).toBe(TICKET_ID)
    expect(prisma.board.findUnique).toHaveBeenCalledWith({ where: { key: 'ABC' }, select: { id: true } })
    expect(prisma.ticket.findUnique).toHaveBeenCalledWith({
      where: { boardId_number: { boardId: BOARD_ID, number: 12 } },
      select: { id: true },
    })
  })

  it('キーに該当するボードが無ければ null', async () => {
    mockBoard({ memberRole: 'member' })
    expect(await findTicketIdByDisplayId(user, 'XYZ-1')).toBeNull()
    expect(prisma.ticket.findUnique).not.toHaveBeenCalled()
  })

  it('番号に該当するチケットが無ければ null', async () => {
    mockBoard({ memberRole: 'member' })
    mockTicket(null)
    expect(await findTicketIdByDisplayId(user, 'ABC-1')).toBeNull()
  })

  it('グループ経由のメンバーなら引ける', async () => {
    mockBoard({ viaGroup: true })
    mockTicket({})
    expect(await findTicketIdByDisplayId(user, 'ABC-1')).toBe(TICKET_ID)
  })

  it('管理者でも非メンバーなら null', async () => {
    mockBoard({})
    mockTicket({})
    expect(await findTicketIdByDisplayId(admin, 'ABC-1')).toBeNull()
  })
})

describe('canViewAttachment', () => {
  it('グループ経由のメンバーならチケットを数えずに読める', async () => {
    mockBoard({ viaGroup: true })
    expect(await canViewAttachment(user, { key: 'k.webp', boardId: BOARD_ID })).toBe(true)
    expect(prisma.ticket.count).not.toHaveBeenCalled()
  })

  it('管理者でも非メンバーなら承認対象の参照が無ければ読めない', async () => {
    mockBoard({})
    vi.mocked(prisma.ticket.count).mockResolvedValue(0)
    expect(await canViewAttachment(admin, { key: 'k.webp', boardId: BOARD_ID })).toBe(false)
  })
})
