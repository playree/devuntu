/**
 * ダッシュボードの「自分宛てのメンション」「最近更新されたチケット」Widget 用の取得処理。
 *
 * どちらも可視スコープは必ず resolveAccessibleBoardIds の結果で付ける
 * (メンションはボードから外れた後も残るので、見えないボードのものは出さない)。
 */

import type { TicketStatus } from '@/generated/prisma/enums'
import { prisma } from '../prisma'
import { commentAnchorId, ticketDisplayId, ticketShortPath } from './ticket-id'
import { ticketScopeWhere } from './ticket-search'
import { resolveAccessibleBoardIds } from './ticket-widget'

/** 自分宛てのメンションの表示件数 */
export const MENTIONS_LIMIT = 10

/** 最近更新されたチケットの表示件数 */
export const RECENT_ACTIVITY_LIMIT = 10

const TICKET_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  dueDate: true,
  board: { select: { key: true } },
} as const

type TicketRow = {
  id: string
  number: number
  title: string
  status: TicketStatus
  dueDate: Date | null
  board: { key: string }
}

const toTicket = ({ board, number, ...ticket }: TicketRow) => ({
  ...ticket,
  displayId: ticketDisplayId({ key: board.key, number }),
})

export type MentionItem = {
  /** チケット本文なら ticket:<id>、コメントなら comment:<id>(行の key) */
  key: string
  kind: 'ticket' | 'comment'
  href: string
  ticket: ReturnType<typeof toTicket>
  /** コメントの投稿者。本文は誰が書き足したメンションか分からないので null */
  authorName: string | null
  at: Date
}

/**
 * 自分宛てのメンション(チケット本文とコメント)を新しい順に MENTIONS_LIMIT 件。
 * チケット本文は編集で追加されたメンションもあるので updatedAt、コメントは投稿日時で並べる。
 * 自分のコメント中の自分宛てメンションは通知と同じく自分への知らせとしない。
 */
export const listMentions = async (userId: string): Promise<MentionItem[]> => {
  const scope = ticketScopeWhere(await resolveAccessibleBoardIds(userId))
  const mentioned = { mentionedUserIds: { has: userId } }

  const [tickets, comments] = await Promise.all([
    prisma.ticket.findMany({
      where: { AND: [scope, mentioned] },
      select: { ...TICKET_SELECT, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: MENTIONS_LIMIT,
    }),
    prisma.ticketComment.findMany({
      where: {
        AND: [mentioned, { ticket: scope }, { OR: [{ authorId: null }, { authorId: { not: userId } }] }],
      },
      select: {
        id: true,
        createdAt: true,
        author: { select: { name: true } },
        ticket: { select: TICKET_SELECT },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MENTIONS_LIMIT,
    }),
  ])

  const items: MentionItem[] = [
    ...tickets.map(({ updatedAt, ...row }) => {
      const ticket = toTicket(row)
      return {
        key: `ticket:${ticket.id}`,
        kind: 'ticket' as const,
        href: ticketShortPath(ticket.displayId),
        ticket,
        authorName: null,
        at: updatedAt,
      }
    }),
    ...comments.map(({ id, createdAt, author, ticket: row }) => {
      const ticket = toTicket(row)
      return {
        key: `comment:${id}`,
        kind: 'comment' as const,
        href: `${ticketShortPath(ticket.displayId)}#${commentAnchorId(id)}`,
        ticket,
        authorName: author?.name ?? null,
        at: createdAt,
      }
    }),
  ]
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, MENTIONS_LIMIT)
}

/** 可視ボードのチケットを更新日時の新しい順に RECENT_ACTIVITY_LIMIT 件(完了も含む) */
export const listRecentActivity = async (userId: string) => {
  const tickets = await prisma.ticket.findMany({
    where: ticketScopeWhere(await resolveAccessibleBoardIds(userId)),
    select: { ...TICKET_SELECT, updatedAt: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: RECENT_ACTIVITY_LIMIT,
  })
  return tickets.map(({ updatedAt, ...row }) => ({ ...toTicket(row), updatedAt }))
}
