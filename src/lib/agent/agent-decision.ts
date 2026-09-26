/**
 * エージェントの plan / report への承認・差し戻し(サーバー専用)
 *
 * 返答は通常の返信コメントとして投稿し、`TicketComment.decision` で種別を持たせる。
 * plan への返答は既存の再開条件(エージェントの最新コメントより後の返信 = revise)にそのまま乗る。
 * report は処理を終えた後なので、差し戻しのときだけ `agentState` を `planned` へ戻して revise で再開させる。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { AgentTaskState, TicketCommentDecision, TicketCommentType, TicketStatus } from '@/generated/prisma/enums'
import { assertTicketAccess, type Actor } from '../board/board-access'
import { insertComment } from '../board/ticket-mutation'
import { moveTicketToLane } from '../board/ticket-write'
import { errInvalidOperation } from '../error'
import { enqueueTicketMoved } from '../notify/notify-trigger'
import { prisma, type Db } from '../prisma'

/** 返答待ちの plan / report */
export type PendingAgentDecision = { commentId: string; type: TicketCommentType }

type DecisionTicket = {
  id: string
  assigneeId: string | null
  assigneeIsAgent: boolean
  agentState: AgentTaskState | null
  status: TicketStatus
}

/** 返答を待つ処理状態と、そのとき返答の対象になるコメントの種別 */
const AWAITING_TYPE: Partial<Record<AgentTaskState, TicketCommentType>> = {
  planned: 'plan',
  done: 'report',
}

/**
 * 承認/差し戻しボタンを出す対象。無ければ null。
 *
 * 担当エージェントの最新コメントが、処理状態に対応する plan / report で、その後に誰の返信も無いこと。
 * 質問(通常コメント)で返答待ちになっている場合や、既に誰かが返信した後は対象にしない。
 */
export const findPendingAgentDecision = async (
  ticket: DecisionTicket,
  tx: Db = prisma,
): Promise<PendingAgentDecision | null> => {
  const expected = ticket.agentState ? AWAITING_TYPE[ticket.agentState] : undefined
  if (!expected || !ticket.assigneeIsAgent || !ticket.assigneeId || ticket.status === 'done') {
    return null
  }

  const last = await tx.ticketComment.findFirst({
    where: { ticketId: ticket.id, authorId: ticket.assigneeId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, createdAt: true },
  })
  if (!last || last.type !== expected) {
    return null
  }

  const reply = await tx.ticketComment.findFirst({
    where: {
      ticketId: ticket.id,
      createdAt: { gt: last.createdAt },
      OR: [{ authorId: { not: ticket.assigneeId } }, { authorId: null }],
    },
    select: { id: true },
  })
  return reply ? null : { commentId: last.id, type: expected }
}

/** 判定に要るチケットの項目 */
const decisionTicketSelect = {
  id: true,
  assigneeId: true,
  agentState: true,
  status: true,
  assignee: { select: { isAgent: true } },
} as const satisfies Prisma.TicketSelect

type DecisionTicketRow = Prisma.TicketGetPayload<{ select: typeof decisionTicketSelect }>

const toDecisionTicket = ({ assignee, ...ticket }: DecisionTicketRow): DecisionTicket => ({
  ...ticket,
  assigneeIsAgent: assignee?.isAgent ?? false,
})

/** チケット1件の返答待ち。詳細画面で使う */
export const findPendingAgentDecisionById = async (ticketId: string, tx: Db = prisma) => {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, select: decisionTicketSelect })
  return ticket ? await findPendingAgentDecision(toDecisionTicket(ticket), tx) : null
}

export type DecideAgentCommentInput = { commentId: string; decision: TicketCommentDecision; content: string }

/**
 * plan / report への承認・差し戻し。チケットを編集できる人(ボードのメンバー)だけが行える。
 * エージェントの承認者であってもメンバーでなければ返答できない(承認者は「任せてよいか」だけを判断する)。
 *
 * - 返信は対象コメントのスレッドへ付ける(対象が返信なら、その親のスレッド)
 * - report の承認: チケットを完了にする
 * - report の差し戻し: `agentState` を `planned` へ戻し、次のポーリングで revise として拾わせる
 */
export const decideAgentComment = async (actor: Actor, input: DecideAgentCommentInput) =>
  prisma.$transaction(async (tx) => {
    const target = await tx.ticketComment.findUnique({
      where: { id: input.commentId },
      select: { id: true, ticketId: true, parentId: true },
    })
    if (!target) {
      throw errInvalidOperation()
    }
    const access = await assertTicketAccess(actor, target.ticketId, 'edit', tx)

    // 同じ plan / report へ同時に返答されても、返答待ちの判定と投稿を直列にする
    await tx.$queryRaw`SELECT "id" FROM "ticket" WHERE "id" = ${target.ticketId} FOR UPDATE`
    const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: target.ticketId }, select: decisionTicketSelect })
    const pending = await findPendingAgentDecision(toDecisionTicket(ticket), tx)
    if (pending?.commentId !== target.id) {
      throw errInvalidOperation()
    }

    const comment = await insertComment(tx, actor, access, {
      ticketId: target.ticketId,
      content: input.content,
      parentId: target.parentId ?? target.id,
      decision: input.decision,
    })

    if (pending.type === 'report') {
      if (input.decision === 'approved') {
        const lane = await moveTicketToLane(tx, { access, status: 'done' })
        await enqueueTicketMoved(
          { actorId: actor.id, ticketId: target.ticketId, before: access.status, after: lane.status },
          tx,
        )
      } else {
        await tx.ticket.update({ where: { id: target.ticketId }, data: { agentState: 'planned' } })
      }
    }

    return { id: comment.id, ticketId: target.ticketId, type: pending.type, decision: input.decision }
  })

/**
 * エージェントの最新コメント以降に付いた、最新の承認/差し戻し。revise で再開したエージェントへ渡す。
 * ボタンを使わずに書かれた返信だけの場合は null(返信の内容はコメントから読ませる)。
 */
export const findLatestAgentDecision = async (ticketId: string, agentUserId: string, tx: Db = prisma) => {
  const last = await tx.ticketComment.findFirst({
    where: { ticketId, authorId: agentUserId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  // 担当が替わった直後などでエージェント自身のコメントが無ければ、残っている返答は別の相手へのもの
  if (!last) {
    return null
  }
  return await tx.ticketComment.findFirst({
    where: { ticketId, decision: { not: null }, createdAt: { gt: last.createdAt } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, decision: true, content: true },
  })
}
