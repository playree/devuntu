/**
 * チケットの変更履歴(サーバー専用)
 *
 * 記録は変更と同じトランザクションで行う(`ticket-mutation.ts` / `ticket-write.ts`)。
 * 何を記録するかの判定は `ticket-activity-rule.ts`。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { TicketActivitySource } from '@/generated/prisma/enums'
import { prisma, type Db } from '../prisma'
import type { TicketActivityEntry } from './ticket-activity-rule'

/** 変更した主体。人・エージェントの操作は actorId、自動の変更は source で表す */
export type ActivityBy = { actorId: string; source?: undefined } | { actorId: null; source: TicketActivitySource }

/** 記録する行が無ければ何もしない */
export const recordTicketActivities = async (
  tx: Prisma.TransactionClient,
  ticketId: string,
  by: ActivityBy,
  entries: TicketActivityEntry[],
): Promise<void> => {
  if (entries.length === 0) {
    return
  }
  await tx.ticketActivity.createMany({
    data: entries.map((entry) => ({ ticketId, actorId: by.actorId, source: by.source ?? 'user', ...entry })),
  })
}

/**
 * マージによる自動完了を保留済みか。同じ PR / MR で保留した記録があるか、最後のステータス変更より後に
 * (どの PR / MR でも)保留した記録があれば保留済みとする。再配信や、紐付いた別の PR / MR の閉じたイベントで
 * 保留を重ねないため。チケットの行ロックを取った後に呼ぶ(同時に届いたイベントで二重に記録しない)
 */
export const hasMergeHeld = async (
  tx: Prisma.TransactionClient,
  ticketId: string,
  pullRequest: string,
): Promise<boolean> => {
  const samePullRequest = await tx.ticketActivity.findFirst({
    where: { ticketId, field: 'mergeHeld', before: pullRequest },
    select: { id: true },
  })
  if (samePullRequest) {
    return true
  }
  const latest = await tx.ticketActivity.findFirst({
    where: { ticketId, field: { in: ['status', 'mergeHeld'] } },
    select: { field: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  return latest?.field === 'mergeHeld'
}

/** 新しい順に limit 件 */
export const listTicketActivities = async (ticketId: string, limit: number, tx: Db = prisma) => {
  const rows = await tx.ticketActivity.findMany({
    where: { ticketId },
    select: {
      id: true,
      field: true,
      source: true,
      before: true,
      after: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  })
  return rows.map(({ actor, ...row }) => ({ ...row, actorName: actor?.name ?? '' }))
}
export type TicketActivityRow = Awaited<ReturnType<typeof listTicketActivities>>[number]
