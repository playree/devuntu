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
