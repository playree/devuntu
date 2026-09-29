/**
 * 子チケットの順番待ちの判定(サーバー専用)
 *
 * 同じ親の下で、自分より順番(`TicketRelation.order`)が小さい兄弟が済むまで子は待つ。
 * 済んだかどうかの条件は親の `childAdvance` で決まる(`isSiblingSettled`)。
 * エージェントの待ち行列(`agent-task.ts`)と、画面の「順番待ち」の表示で共通に使う。
 */

import { prisma, type Db } from '../prisma'
import { isWaitingForSiblings } from './ticket-relation-rule'

/** 渡したチケットのうち、順番待ちのものの ID。親の無いチケットは待たない */
export const findWaitingTicketIds = async (ticketIds: readonly string[], tx: Db = prisma): Promise<Set<string>> => {
  if (ticketIds.length === 0) {
    return new Set()
  }

  const relations = await tx.ticketRelation.findMany({
    where: { type: 'parent', toId: { in: [...ticketIds] } },
    select: { toId: true, fromId: true, order: true },
  })
  if (relations.length === 0) {
    return new Set()
  }

  // 同じ親の子が並んでいても、兄弟の一覧は親ごとに 1 回だけ引く
  const parents = await tx.ticket.findMany({
    where: { id: { in: [...new Set(relations.map((relation) => relation.fromId))] } },
    select: {
      id: true,
      childAdvance: true,
      relationsFrom: {
        where: { type: 'parent' },
        select: { order: true, to: { select: { id: true, status: true, agentState: true } } },
      },
    },
  })
  const parentById = new Map(
    parents.map((parent) => [
      parent.id,
      {
        advance: parent.childAdvance,
        siblings: parent.relationsFrom.map((sibling) => ({ ...sibling.to, order: sibling.order })),
      },
    ]),
  )

  const waiting = new Set<string>()
  for (const { toId, fromId, order } of relations) {
    const parent = parentById.get(fromId)
    if (parent && isWaitingForSiblings({ id: toId, order }, parent.siblings, parent.advance)) {
      waiting.add(toId)
    }
  }
  return waiting
}
