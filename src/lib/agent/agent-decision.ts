/**
 * エージェントの plan / report への承認・差し戻し(サーバー専用)
 *
 * 返答は通常の返信コメントとして投稿し、`TicketComment.decision` で種別を持たせる。
 * plan への返答は既存の再開条件(エージェントの最新コメントより後の返信 = revise)にそのまま乗る。
 * report は処理を終えた後なので、差し戻しのときだけ `agentState` を `planned` へ戻して revise で再開させる。
 */

import { Prisma, type TicketComment } from '@/generated/prisma/client'
import type { AgentTaskState, TicketCommentDecision, TicketCommentType, TicketStatus } from '@/generated/prisma/enums'
import { assertTicketAccess, type Actor } from '../board/board-access'
import { lockBoardRow, lockTicketRow } from '../board/row-lock'
import { insertComment } from '../board/ticket-mutation'
import { moveTicketToLane } from '../board/ticket-write'
import { errInvalidOperation } from '../error'
import { enqueueTicketMoved } from '../notify/notify-trigger'
import { prisma, type Db } from '../prisma'
import { parseChildProposal } from '../schema/schema-ticket'
import { applyChildProposal } from './agent-proposal'
import { agentReplyWhere } from './agent-task'

/** 返答待ちの plan / report。`proposedChildren` は plan に付いた起票案の子チケット数(無ければ 0) */
export type PendingAgentDecision = { commentId: string; type: TicketCommentType; proposedChildren: number }

type DecisionTicket = {
  id: string
  assigneeId: string | null
  assigneeIsAgent: boolean
  agentState: AgentTaskState | null
  status: TicketStatus
}

type LastAgentComment = Pick<TicketComment, 'id' | 'ticketId' | 'type' | 'createdAt' | 'proposal'>

/** 返答を待つ処理状態と、そのとき返答の対象になるコメントの種別 */
const AWAITING_TYPE: Partial<Record<AgentTaskState, TicketCommentType>> = {
  planned: 'plan',
  done: 'report',
}

/**
 * 承認/差し戻しボタンを出す対象を、チケットの件数によらず最大 2 クエリでまとめて引く。対象のチケットだけが Map に入る。
 *
 * 担当エージェントの最新コメントが、処理状態に対応する plan / report で、その後に誰の返信も無いこと(アナウンスは返信に数えない)。
 * 質問(通常コメント)で返答待ちになっている場合や、既に誰かが返信した後は対象にしない。
 */
export const findPendingAgentDecisions = async (
  tickets: DecisionTicket[],
  tx: Db = prisma,
): Promise<Map<string, PendingAgentDecision>> => {
  const awaiting = new Map<string, { agentId: string; expected: TicketCommentType }>()
  for (const ticket of tickets) {
    const expected = ticket.agentState ? AWAITING_TYPE[ticket.agentState] : undefined
    if (expected && ticket.assigneeIsAgent && ticket.assigneeId && ticket.status !== 'done') {
      awaiting.set(ticket.id, { agentId: ticket.assigneeId, expected })
    }
  }
  const pending = new Map<string, PendingAgentDecision>()
  if (awaiting.size === 0) {
    return pending
  }

  // Prisma の distinct はメモリ上で絞るため全コメントを読んでしまう。チケットごとに 1 行だけ返す DISTINCT ON で引く
  const lasts = await tx.$queryRaw<LastAgentComment[]>`
    SELECT DISTINCT ON (c."ticketId") c."id", c."ticketId", c."type", c."createdAt", c."proposal"
    FROM "ticket_comment" AS c
    JOIN (VALUES ${Prisma.join(
      [...awaiting].map(([ticketId, { agentId }]) => Prisma.sql`(${ticketId}::text, ${agentId}::text)`),
    )}) AS v("ticketId", "authorId")
      ON c."ticketId" = v."ticketId" AND c."authorId" = v."authorId"
    ORDER BY c."ticketId", c."createdAt" DESC, c."id" DESC
  `
  const candidates = lasts.flatMap((last) => {
    const target = awaiting.get(last.ticketId)
    return target && last.type === target.expected ? [{ ...last, ...target }] : []
  })
  if (candidates.length === 0) {
    return pending
  }

  const replied = await tx.ticketComment.groupBy({
    by: ['ticketId'],
    where: { OR: candidates.map((last) => agentReplyWhere(last.ticketId, last.agentId, last.createdAt)) },
  })
  const repliedIds = new Set(replied.map(({ ticketId }) => ticketId))
  for (const last of candidates) {
    if (repliedIds.has(last.ticketId)) {
      continue
    }
    const proposal = last.expected === 'plan' ? parseChildProposal(last.proposal) : null
    pending.set(last.ticketId, {
      commentId: last.id,
      type: last.expected,
      proposedChildren: proposal?.children.length ?? 0,
    })
  }
  return pending
}

/** チケット1件の返答待ち({@link findPendingAgentDecisions})。無ければ null */
export const findPendingAgentDecision = async (
  ticket: DecisionTicket,
  tx: Db = prisma,
): Promise<PendingAgentDecision | null> => (await findPendingAgentDecisions([ticket], tx)).get(ticket.id) ?? null

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
 * - 起票案付きの plan の承認: 子チケットを起票し、親の処理を終える(`applyChildProposal`)
 * - report の承認: チケットを完了にする
 * - report の差し戻し: `agentState` を `planned` へ戻し、次のポーリングで revise として拾わせる
 */
export const decideAgentComment = async (actor: Actor, input: DecideAgentCommentInput) =>
  prisma.$transaction(async (tx) => {
    const target = await tx.ticketComment.findUnique({
      where: { id: input.commentId },
      select: { id: true, ticketId: true, parentId: true, proposal: true },
    })
    if (!target) {
      throw errInvalidOperation()
    }
    const access = await assertTicketAccess(actor, target.ticketId, 'edit', tx)

    /**
     * 起票案の承認は子チケットの採番でボード行をロックする。通常のチケット作成は「ボード → 親」の順に
     * ロックするので、こちらも親より先にボードを取って順番をそろえる(逆順だと同じ親への作成とデッドロックする)
     */
    if (input.decision === 'approved' && target.proposal !== null) {
      await lockBoardRow(tx, access.boardId)
    }
    // 同じ plan / report へ同時に返答されても、返答待ちの判定と投稿を直列にする
    await lockTicketRow(tx, target.ticketId)
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

    const proposal = pending.type === 'plan' ? parseChildProposal(target.proposal) : null
    const children =
      proposal && input.decision === 'approved' ? await applyChildProposal(tx, actor, access, proposal) : []

    if (pending.type === 'report') {
      if (input.decision === 'approved') {
        // 変更前のステータスはロック後に読み直した値を使う(access はロック前に読んでいる)
        const lane = await moveTicketToLane(tx, {
          access: { ...access, status: ticket.status },
          status: 'done',
          by: { actorId: actor.id },
        })
        await enqueueTicketMoved(
          { actorId: actor.id, ticketId: target.ticketId, before: ticket.status, after: lane.status },
          tx,
        )
      } else {
        await tx.ticket.update({ where: { id: target.ticketId }, data: { agentState: 'planned' } })
      }
    }

    return {
      id: comment.id,
      ticketId: target.ticketId,
      type: pending.type,
      decision: input.decision,
      childTicketIds: children.map((child) => child.id),
    }
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
