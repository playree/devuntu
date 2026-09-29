/**
 * エージェントによるタスク分割(子チケットの起票案)(サーバー専用)
 *
 * エージェントは plan に起票案(`TicketComment.proposal`)を付けて投稿し、人が承認すると
 * 同じトランザクションで子チケットを起票する(`agent-decision.ts` の承認から呼ぶ)。
 * 差し戻し・通常の返信は既存の plan と同じく revise で起票案を直させる。
 */

import type { Prisma } from '@/generated/prisma/client'
import { assertTicketAccess, type Actor, type TicketAccess } from '../board/board-access'
import { insertComment, insertTicket } from '../board/ticket-mutation'
import { prisma } from '../prisma'
import type { ChildProposal } from '../schema/schema-ticket'

/** 起票案付きの plan を投稿する。担当・オプトインの確認は呼び出し側(MCP ツール)で済ませる */
export const postChildProposal = async (actor: Actor, ticketId: string, content: string, proposal: ChildProposal) =>
  prisma.$transaction(async (tx) => {
    const access = await assertTicketAccess(actor, ticketId, 'edit', tx)
    return insertComment(tx, actor, access, { ticketId, content, type: 'plan', proposal })
  })

/**
 * 承認された起票案から子チケットを作る。
 *
 * - 優先度・タグは親から引き継ぎ、順番は起票案のとおりに付ける
 * - 処理方式のある子は親の担当エージェントへ割り当てる。処理方式(`agentMode`)を付けるのは、
 *   承認した人がそのエージェントの承認者の場合だけ(任せる判断は承認者の役割なので、そうでなければ未設定で作る)
 * - 処理方式の無い子は人が担当する前提で、未割り当てで作る
 * - 順番は親の既存の子と同じ並びに入る(既存の子より後に進めたい場合は、エージェントが大きい順番を付ける)
 * - 次へ進む条件は起票案で指定があるときだけ親へ書き込み、無ければ親の設定のまま残す
 * - 親は分割したことで処理を終えたものとし、`agentState` を `done` にする(親自体は実装しない)
 */
export const applyChildProposal = async (
  tx: Prisma.TransactionClient,
  actor: Actor,
  access: TicketAccess,
  proposal: ChildProposal,
) => {
  const parent = await tx.ticket.findUniqueOrThrow({
    where: { id: access.ticketId },
    select: { priority: true, tags: { select: { tagId: true } } },
  })

  const created = []
  for (const child of proposal.children) {
    const ticket = await insertTicket(tx, actor, {
      boardId: access.boardId,
      title: child.title,
      content: child.content,
      status: 'todo',
      priority: parent.priority,
      tagIds: parent.tags.map(({ tagId }) => tagId),
      assigneeId: child.mode ? access.assigneeId : null,
      criteria: child.acceptanceCriteria,
      parentId: access.ticketId,
      childOrder: child.order,
    })
    if (child.mode && access.canEditAgentMode) {
      await tx.ticket.update({ where: { id: ticket.id }, data: { agentMode: child.mode, agentState: null } })
    }
    created.push(ticket)
  }

  await tx.ticket.update({
    where: { id: access.ticketId },
    data: { ...(proposal.advance && { childAdvance: proposal.advance }), agentState: 'done' },
  })
  return created
}
