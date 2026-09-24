/**
 * ダッシュボードのチケット系 Widget 用の取得処理。
 *
 * どれも「担当が自分」のチケットだけを対象にし、可視スコープは必ず buildTicketWhere を通して付ける
 * (担当者から外れたボードのチケットが担当のまま残っていても、見えないボードのものは出さない)。
 */

import type { TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import { addDaysDateOnly, dateOnlyToUtc, DEFAULT_TZ, now, todayDateOnly } from '../day'
import { prisma } from '../prisma'
import { ensurePrivateBoard, getAccessibleBoardIds } from './board'
import { buildTicketWhere, OPEN_TICKET_STATUSES, ticketDisplayId } from './task'

/** 自分の担当チケットの表示件数 */
export const MY_TICKETS_LIMIT = 10

/** 期限切れ・期限間近の表示件数 */
export const DUE_SOON_LIMIT = 20

/** 期限間近とみなす日数(今日を含めて今日+N日まで) */
export const DUE_SOON_DAYS = 7

/** 集計で done を数える期間(日) */
export const DONE_RECENT_DAYS = 7

const WIDGET_TICKET_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  board: { select: { key: true } },
} as const

type WidgetTicketRow = {
  id: string
  number: number
  title: string
  status: TicketStatus
  priority: TicketPriority
  dueDate: Date | null
  board: { key: string }
}

const toWidgetTicket = ({ board, number, ...ticket }: WidgetTicketRow) => ({
  ...ticket,
  displayId: ticketDisplayId({ key: board.key, number }),
})

/** 可視ボードの一覧。プライベートチケットもボード経由で可視化するため、先にプライベートボードを用意する */
export const resolveAccessibleBoardIds = async (userId: string) => {
  await ensurePrivateBoard({ id: userId })
  return getAccessibleBoardIds(userId)
}

/** 担当が自分で、指定ステータスのいずれかにあるチケットの where */
const myTicketWhere = (userId: string, accessibleBoardIds: string[], status: TicketStatus[]) =>
  buildTicketWhere({ keyword: '', status, priority: [], tags: [], assignee: userId }, { accessibleBoardIds })

/** 自分の担当で未完了のチケット。優先度 → 期日(未設定は末尾)の順 */
export const listMyTickets = async (userId: string) => {
  const tickets = await prisma.ticket.findMany({
    where: myTicketWhere(userId, await resolveAccessibleBoardIds(userId), OPEN_TICKET_STATUSES),
    select: WIDGET_TICKET_SELECT,
    orderBy: [{ priority: 'asc' }, { dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    take: MY_TICKETS_LIMIT,
  })
  return tickets.map(toWidgetTicket)
}

/** 自分の担当で未完了のうち、期限切れ〜今日+DUE_SOON_DAYS 日が期日のチケット。期日の近い順 */
export const listDueSoonTickets = async (userId: string, tz: string = DEFAULT_TZ) => {
  const where = myTicketWhere(userId, await resolveAccessibleBoardIds(userId), OPEN_TICKET_STATUSES)
  // 期日は UTC 0:00 の日付として保存されているので、ユーザーの TZ の暦日から境界を作る
  const until = dateOnlyToUtc(addDaysDateOnly(todayDateOnly(tz), DUE_SOON_DAYS))
  const tickets = await prisma.ticket.findMany({
    where: { AND: [where, { dueDate: { lte: until ?? undefined, not: null } }] },
    select: WIDGET_TICKET_SELECT,
    orderBy: [{ dueDate: 'asc' }, { priority: 'asc' }, { id: 'asc' }],
    take: DUE_SOON_LIMIT,
  })
  return tickets.map(toWidgetTicket)
}

/** 自分の担当チケットのステータス別件数。done は直近 DONE_RECENT_DAYS 日に完了したものだけを数える */
export const countMyTicketsByStatus = async (userId: string): Promise<Record<TicketStatus, number>> => {
  const accessibleBoardIds = await resolveAccessibleBoardIds(userId)
  const openWhere = myTicketWhere(userId, accessibleBoardIds, OPEN_TICKET_STATUSES)
  const doneWhere = myTicketWhere(userId, accessibleBoardIds, ['done'])
  const [groups, done] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], where: openWhere, _count: { _all: true } }),
    prisma.ticket.count({
      where: { AND: [doneWhere, { completedAt: { gte: now().subtract(DONE_RECENT_DAYS, 'day').toDate() } }] },
    }),
  ])

  const counts: Record<TicketStatus, number> = { backlog: 0, todo: 0, doing: 0, done }
  for (const group of groups) {
    counts[group.status] = group._count._all
  }
  return counts
}
