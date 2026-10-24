/**
 * add_ticket_comment の type=announcement は、ボードメンバー全員へ届くので投稿するかを利用者が決める。
 * 人の経路は利用者の了承(userApproved)が要り、エージェントの経路は投稿できない。
 * 投稿したら、Slack チャンネルへ流れる設定だったか(announced)を返す
 */

import { addComment } from '@/lib/board/ticket-mutation'
import { ClientError } from '@/lib/error'
import { addTicketCommentForMcp, ANNOUNCEMENT_DENIED } from '@/lib/mcp/mcp-ticket'
import { isChannelNotifyEnabled } from '@/lib/notify/notify-board-setting'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentAuth, oauthAuth, patAuth } from '../../helpers/resource-auth'

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({ ticket: ['findUnique'] }))
vi.mock('@/lib/board/ticket-mutation', () => ({ addComment: vi.fn() }))
vi.mock('@/lib/notify/notify-board-setting', () => ({ isChannelNotifyEnabled: vi.fn() }))

const TICKET_ID = '0195c1e0-0000-7000-8000-0000000000aa'
const COMMENT_ID = '0195c1e0-0000-7000-8000-0000000000cc'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(addComment).mockResolvedValue({ id: COMMENT_ID, mentionedUserIds: [] })
  vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ boardId: 'board-1' } as never)
  vi.mocked(isChannelNotifyEnabled).mockResolvedValue(true)
})

/** 拒否されたときのエラー種別 */
const rejectedType = async (run: () => Promise<unknown>) => {
  const error = await run().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ClientError)
  return (error as ClientError).errorType
}

describe('addTicketCommentForMcp: アナウンス', () => {
  it.each([
    ['OAuth', oauthAuth()],
    ['ユーザートークン', patAuth()],
  ])('%s: 利用者の了承があれば投稿し、Slack へ流れたかを返す', async (_label, auth) => {
    const result = await addTicketCommentForMcp(auth, TICKET_ID, 'リリースしました', 'announcement', null, true)

    expect(result).toEqual({ id: COMMENT_ID, announced: true })
    expect(addComment).toHaveBeenCalledWith(auth.user, {
      ticketId: TICKET_ID,
      content: 'リリースしました',
      type: 'announcement',
      parentId: null,
    })
    expect(isChannelNotifyEnabled).toHaveBeenCalledWith('board-1', 'announcement')
  })

  it('チャンネルへ流れないボードでは announced=false(記録だけ残る)', async () => {
    vi.mocked(isChannelNotifyEnabled).mockResolvedValue(false)

    expect(await addTicketCommentForMcp(oauthAuth(), TICKET_ID, 'x', 'announcement', null, true)).toEqual({
      id: COMMENT_ID,
      announced: false,
    })
  })

  it('人の経路でも了承(userApproved=true)が無ければ投稿しない', async () => {
    for (const userApproved of [undefined, false]) {
      expect(
        await rejectedType(() =>
          addTicketCommentForMcp(oauthAuth(), TICKET_ID, 'x', 'announcement', null, userApproved),
        ),
      ).toBe(ANNOUNCEMENT_DENIED)
    }
    expect(addComment).not.toHaveBeenCalled()
  })

  it('エージェントの経路は了承を申告しても投稿できない(確認する相手がいない)', async () => {
    expect(
      await rejectedType(() => addTicketCommentForMcp(agentAuth(), TICKET_ID, 'x', 'announcement', null, true)),
    ).toBe(ANNOUNCEMENT_DENIED)
    expect(addComment).not.toHaveBeenCalled()
  })

  it('アナウンス以外のコメントは了承が要らず、announced も返さない', async () => {
    for (const auth of [oauthAuth(), agentAuth()]) {
      for (const type of [null, 'plan', 'report'] as const) {
        expect(await addTicketCommentForMcp(auth, TICKET_ID, 'x', type)).toEqual({ id: COMMENT_ID })
      }
    }
    expect(isChannelNotifyEnabled).not.toHaveBeenCalled()
  })
})
