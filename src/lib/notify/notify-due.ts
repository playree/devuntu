/**
 * 期限のリマインド(サーバー専用)
 *
 * ほかのトリガーは操作をきっかけに投入するが、これだけは時刻をきっかけにする。
 * ワーカー(`notify-due-worker.ts`)が定期的に呼び、期限が明日 / 今日になったチケットを
 * 担当者へ知らせる。
 *
 * 期限は日付だけで時刻を持たないので、宛先のタイムゾーンで `DUE_REMIND_MINUTES` を過ぎたら送る。
 * 送ったことは `TicketDueReminder` に記録し、同じリマインドを二度投入しない。
 */

import type { DueRemindKind } from '@/generated/prisma/enums'
import { ticketDisplayId } from '../board/ticket-id'
import { addDaysDateOnly, DAY_MS, nowDate, toZone, utcToDateOnly, zonedMinutes } from '../day'
import { envu } from '../env-util'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { DUE_REMIND_BATCH, DUE_REMIND_MINUTES } from './notify'
import { enqueueNotify } from './notify-enqueue'
import { ticketOwnerIds } from './notify-recipient'

/**
 * 今送るべきリマインドの種類。送る時刻の前と、期限が明日 / 今日でないときは null。
 *
 * 期限を過ぎたものは送らない(ワーカーが止まっていた間の分を後からまとめて送らない)。
 */
export const dueRemindKind = (dueDate: Date, now: Date, tz: string): DueRemindKind | null => {
  const today = toZone(now, tz).format('YYYY-MM-DD')
  if (now.getTime() < zonedMinutes(today, DUE_REMIND_MINUTES, tz).valueOf()) {
    return null
  }
  const due = utcToDateOnly(dueDate)
  if (due === today) {
    return 'due_day'
  }
  if (due === addDaysDateOnly(today, 1)) {
    return 'day_before'
  }
  return null
}

const OWNER_SELECT = { id: true, isAgent: true, timezone: true } as const

type Owner = { id: string; isAgent: boolean; timezone: string | null }

/**
 * 宛先は `notify-recipient.ts` の `ticketOwnerIds` と同じ決め方。送る時刻をその人のタイムゾーンで決めるために引く。
 * 閲覧権限までは見ないので、投入の直前に `ticketOwnerIds` と突き合わせる
 */
const ownerOf = (ticket: { assignee: Owner | null; createdBy: Owner | null }): Owner | null => {
  const owner = ticket.assignee && !ticket.assignee.isAgent ? ticket.assignee : ticket.createdBy
  return owner && !owner.isAgent ? owner : null
}

/** どれかのチャネルで期限のリマインドを受け取るユーザー */
const remindableUserIds = async (userIds: string[]): Promise<Set<string>> => {
  if (userIds.length === 0) {
    return new Set()
  }
  const rows = await prisma.userNotifySetting.findMany({
    where: {
      userId: { in: userIds },
      event: 'ticket_due',
      OR: [{ email: true }, { slack: true }, { webpush: true }],
    },
    select: { userId: true },
  })
  return new Set(rows.map(({ userId }) => userId))
}

/** 流量制限で投入できなかった。枠が空くまでこの周を打ち切る */
class DueRemindThrottled extends Error {}

/**
 * 期限のリマインドを1周ぶん投入する。投入した件数を返す。
 *
 * 受け取る設定が無い宛先は記録も作らずに飛ばすので、その日のうちに設定を ON にすれば次の周で届く。
 */
export const runDueRemind = async (now: Date = nowDate()): Promise<number> => {
  // 期限は UTC 0:00 の日付なので、どのタイムゾーンの「今日 / 明日」も覆う幅で引いてから宛先ごとに判定する
  const todayUtc = Math.floor(now.getTime() / DAY_MS) * DAY_MS
  const from = new Date(todayUtc - DAY_MS)
  const to = new Date(todayUtc + 2 * DAY_MS)

  const tickets = await prisma.ticket.findMany({
    where: { dueDate: { gte: from, lte: to }, status: { not: 'done' }, board: { archived: false } },
    select: {
      id: true,
      boardId: true,
      number: true,
      title: true,
      dueDate: true,
      board: { select: { key: true } },
      assignee: { select: OWNER_SELECT },
      createdBy: { select: OWNER_SELECT },
      dueReminders: { where: { dueDate: { gte: from, lte: to } }, select: { kind: true, dueDate: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
  })

  const remindable = await remindableUserIds([...new Set(tickets.flatMap((ticket) => ownerOf(ticket)?.id ?? []))])

  const targets = tickets.flatMap((ticket) => {
    const owner = ownerOf(ticket)
    if (!ticket.dueDate || !owner || !remindable.has(owner.id)) {
      return []
    }
    const kind = dueRemindKind(ticket.dueDate, now, owner.timezone ?? envu.server.DEFAULT_TIMEZONE)
    const dueTime = ticket.dueDate.getTime()
    if (!kind || ticket.dueReminders.some((r) => r.kind === kind && r.dueDate.getTime() === dueTime)) {
      return []
    }
    return [{ ticket, owner, dueDate: ticket.dueDate, kind }]
  })

  let enqueued = 0
  let attempted = 0
  for (const { ticket, owner, dueDate, kind } of targets) {
    if (attempted >= DUE_REMIND_BATCH) {
      break
    }
    // 閲覧できなくなった宛先には配信側も送らない。記録だけを残すと、権限が戻ってもその日は送れなくなる。
    // 上限はこの確認の後で数える(送れない候補が先頭に溜まって、後ろの候補が毎周あふれることが無いように)
    if (!(await ticketOwnerIds(ticket.id)).includes(owner.id)) {
      continue
    }
    attempted++
    try {
      // 記録を作れたときだけ投入する。多重に走っても、記録の一意制約でどちらか一方だけが送る
      const created = await prisma.$transaction(async (tx) => {
        const { count } = await tx.ticketDueReminder.createMany({
          data: [{ ticketId: ticket.id, kind, dueDate }],
          skipDuplicates: true,
        })
        if (count === 0) {
          return false
        }
        const payload = {
          ticketId: ticket.id,
          boardId: ticket.boardId,
          displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
          ticketTitle: ticket.title,
          kind,
          dueDate: dueDate.toISOString().slice(0, 10),
        }
        if (!(await enqueueNotify({ event: 'ticket_due', payload }, tx))) {
          // 記録ごと取り消して、次の周で送り直す
          throw new DueRemindThrottled()
        }
        return true
      })
      if (created) {
        enqueued++
      }
    } catch (error) {
      if (error instanceof DueRemindThrottled) {
        break
      }
      // 引いた後にチケットが消えた(外部キー違反)など。1件の失敗で残りを次の周へ回さない
      logger.warn({ error, ticketId: ticket.id }, 'due remind skipped')
    }
  }

  if (enqueued > 0 || attempted >= DUE_REMIND_BATCH) {
    logger.info({ enqueued, candidates: targets.length }, 'due remind enqueued')
  }
  return enqueued
}
