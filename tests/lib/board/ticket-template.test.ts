/** テンプレートの引き当て(ID / 名前)と、削除済みタグの除外、件数上限を検証する */

import { createTicketTemplate, findTicketTemplate, listTicketTemplates } from '@/lib/board/ticket-template'
import { MAX_TEMPLATES_PER_BOARD } from '@/lib/board/ticket-template-rule'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    ticketTemplate: ['findMany', 'findFirst', 'count', 'create'],
    tag: ['findMany', 'count'],
  }),
)

vi.mock('@/lib/board/board-access', () => ({ assertBoardAccess: vi.fn() }))
vi.mock('@/lib/board/board-setting', () => ({ assertBoardContentManageable: vi.fn() }))

const { assertBoardContentManageable } = await import('@/lib/board/board-setting')

const BOARD_ID = '0195c1e0-0000-7000-8000-000000000001'
const TEMPLATE_ID = '0195c1e0-0000-7000-8000-0000000000aa'
const actor = { id: 'u1', role: 'user' } as never

const row = {
  id: TEMPLATE_ID,
  name: '不具合',
  content: '',
  criteria: [],
  tagIds: ['tag-1', 'gone'],
  priority: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.tag.findMany).mockResolvedValue([{ id: 'tag-1' }] as never)
})

describe('listTicketTemplates', () => {
  it('ボードに無くなったタグをテンプレートの既定タグから外す', async () => {
    vi.mocked(prisma.ticketTemplate.findMany).mockResolvedValueOnce([row] as never)

    expect(await listTicketTemplates(BOARD_ID)).toEqual([{ ...row, tagIds: ['tag-1'] }])
  })

  it('テンプレートが無ければタグを引かない', async () => {
    vi.mocked(prisma.ticketTemplate.findMany).mockResolvedValueOnce([] as never)

    expect(await listTicketTemplates(BOARD_ID)).toEqual([])
    expect(prisma.tag.findMany).not.toHaveBeenCalled()
  })
})

describe('findTicketTemplate', () => {
  it('UUID は ID として、それ以外は名前として同じボードの中から引く', async () => {
    vi.mocked(prisma.ticketTemplate.findFirst).mockResolvedValue(row as never)

    await findTicketTemplate(BOARD_ID, TEMPLATE_ID)
    expect(vi.mocked(prisma.ticketTemplate.findFirst).mock.calls[0][0]?.where).toEqual({
      boardId: BOARD_ID,
      id: TEMPLATE_ID,
    })

    await findTicketTemplate(BOARD_ID, ' 不具合 ')
    expect(vi.mocked(prisma.ticketTemplate.findFirst).mock.calls[1][0]?.where).toEqual({
      boardId: BOARD_ID,
      name: '不具合',
    })
  })

  it('見つからなければエラーにする', async () => {
    vi.mocked(prisma.ticketTemplate.findFirst).mockResolvedValueOnce(null as never)

    await expect(findTicketTemplate(BOARD_ID, 'nope')).rejects.toThrow()
  })
})

describe('createTicketTemplate', () => {
  const input = { boardId: BOARD_ID, name: '不具合', content: '', criteria: [], tagIds: [], priority: null }

  it('権限を確かめてから作成する', async () => {
    vi.mocked(prisma.ticketTemplate.count).mockResolvedValueOnce(0)
    vi.mocked(prisma.ticketTemplate.create).mockResolvedValueOnce({ id: TEMPLATE_ID, name: '不具合' } as never)

    await createTicketTemplate(actor, input)

    expect(assertBoardContentManageable).toHaveBeenCalledWith(actor, BOARD_ID, expect.anything())
    expect(prisma.ticketTemplate.create).toHaveBeenCalled()
  })

  it('上限に達していれば作成しない', async () => {
    vi.mocked(prisma.ticketTemplate.count).mockResolvedValueOnce(MAX_TEMPLATES_PER_BOARD)

    await expect(createTicketTemplate(actor, input)).rejects.toThrow()
    expect(prisma.ticketTemplate.create).not.toHaveBeenCalled()
  })

  it('権限が無ければ作成しない', async () => {
    vi.mocked(assertBoardContentManageable).mockRejectedValueOnce(new Error('denied'))

    await expect(createTicketTemplate(actor, input)).rejects.toThrow()
    expect(prisma.ticketTemplate.create).not.toHaveBeenCalled()
  })
})
