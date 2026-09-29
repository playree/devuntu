/**
 * CI の失敗・PR / MR のレビュー指摘による、エージェントへの自動差し戻し(サーバー専用)
 *
 * Webhook で受けたきっかけを `AgentAutoReviseTrigger` に記録し、報告済み(`agentState=done`)の
 * チケットを `planned` へ戻す。既存の revise の経路(`agent-task.ts` の `deriveAction`)が、
 * 未消化のきっかけを「返信」と同じように扱って拾う。
 *
 * - 差し戻した後、拾われるまでの間に届いたきっかけは同じ差し戻しにまとめる(回数は増やさない)
 * - 最後のきっかけから `AUTO_REVISE_SETTLE_MS` 経つまでは拾わない(分けて投稿されるレビューを1回の実行にまとめる)
 * - 処理中・人の返信待ち・上限到達のときに届いたきっかけは捨てる
 */

import type { Prisma } from '@/generated/prisma/client'
import type { AgentAutoReviseSource } from '@/generated/prisma/enums'
import { OPEN_TICKET_STATUSES } from '../board/ticket-enum'
import { MINUTE_MS, msBefore, nowDate } from '../day'
import type { GitLinkedBoard, GitRepoKey } from '../git/git-webhook'
import { logger } from '../logger'
import { prisma, type Db } from '../prisma'

/** 最後のきっかけから、エージェントに拾わせるまでの待ち時間 */
export const AUTO_REVISE_SETTLE_MS = 2 * MINUTE_MS

/** 保存するレビュー本文の上限。詳細は PR / MR から読ませる */
const MAX_BODY_LENGTH = 4000

/** 差し戻しの対象にする CI の結果(GitHub の conclusion の形) */
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure'])

export const isFailedConclusion = (conclusion: string | null): boolean =>
  conclusion !== null && FAILED_CONCLUSIONS.has(conclusion)

export type AutoReviseTrigger = {
  source: AgentAutoReviseSource
  /** 同じきっかけを二重に作らないためのキー */
  dedupeKey: string
  /** 失敗したチェックの名前 */
  checks?: string[]
  body?: string | null
  author?: string | null
  reviewState?: string | null
  /** レビュー・コメントの URL。無ければ PR / MR の URL */
  url?: string | null
}

/** きっかけの対象にする PR / MR(番号か、CI の head のどちらかで引く) */
export type AutoRevisePullRequest = { number: number } | { headSha: string }

type AutoReviseResult = 'revised' | 'merged' | 'ignored'

/**
 * チケット1件へのきっかけの反映。行ロックで、ランナーの実行開始(`agentState=running`)と直列にする。
 */
const applyTrigger = async (
  tx: Db,
  ticketId: string,
  limit: number,
  data: Omit<Prisma.AgentAutoReviseTriggerCreateManyInput, 'ticketId'>,
): Promise<AutoReviseResult> => {
  await tx.$queryRaw`SELECT "id" FROM "ticket" WHERE "id" = ${ticketId} FOR UPDATE`
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: { agentState: true, agentAutoReviseCount: true },
  })
  if (!ticket) {
    return 'ignored'
  }

  const existing = await tx.agentAutoReviseTrigger.findUnique({
    where: { ticketId_dedupeKey: { ticketId, dedupeKey: data.dedupeKey } },
    select: { id: true, consumed: true, checks: true },
  })
  if (existing) {
    // 同じ suite / パイプラインの失敗が続けて届いたら、引き受ける前に限ってチェック名を足す
    const checks = [...new Set([...existing.checks, ...((data.checks as string[] | undefined) ?? [])])]
    if (existing.consumed || checks.length === existing.checks.length) {
      return 'ignored'
    }
    await tx.agentAutoReviseTrigger.update({ where: { id: existing.id }, data: { checks } })
    return 'merged'
  }

  if (ticket.agentState === 'planned') {
    const pending = await tx.agentAutoReviseTrigger.findFirst({
      where: { ticketId, consumed: false },
      select: { id: true },
    })
    if (!pending) {
      // 人の返信待ちの plan / 質問。自動のきっかけでは割り込まない
      return 'ignored'
    }
    await tx.agentAutoReviseTrigger.create({ data: { ...data, ticketId } })
    return 'merged'
  }

  if (ticket.agentState !== 'done' || ticket.agentAutoReviseCount >= limit) {
    return 'ignored'
  }
  await tx.agentAutoReviseTrigger.create({ data: { ...data, ticketId } })
  await tx.ticket.update({
    where: { id: ticketId },
    data: { agentState: 'planned', agentAutoReviseCount: { increment: 1 } },
    select: { id: true },
  })
  return 'revised'
}

/**
 * 紐付いた PR / MR のきっかけで、エージェント担当のチケットを差し戻す。
 *
 * 対象は、自動差し戻しを有効にしたボードの、外していない(dismissed でない)開いている PR / MR のリンクを持つ
 * チケットのうち、担当がエージェントでオプトイン済み(`agentMode` あり)かつ未完了のもの。
 */
export const requestAutoRevise = async (
  { key, boards, pullRequest }: { key: GitRepoKey; boards: GitLinkedBoard[]; pullRequest: AutoRevisePullRequest },
  trigger: AutoReviseTrigger,
) => {
  const boardLimits = new Map(
    boards.filter((board) => board.autoRevise).map((board) => [board.id, board.autoReviseLimit]),
  )
  if (boardLimits.size === 0) {
    return
  }

  const links = await prisma.ticketLink.findMany({
    where: {
      ...key,
      kind: 'pull_request',
      dismissed: false,
      ...('number' in pullRequest ? { ref: String(pullRequest.number) } : { headSha: pullRequest.headSha }),
      OR: [{ prState: null }, { prState: { in: ['open', 'draft'] } }],
      ticket: {
        boardId: { in: [...boardLimits.keys()] },
        assignee: { isAgent: true },
        agentMode: { not: null },
        status: { in: [...OPEN_TICKET_STATUSES] },
      },
    },
    select: { ticketId: true, ref: true, url: true, ticket: { select: { boardId: true } } },
  })

  for (const link of links) {
    const number = Number(link.ref)
    const limit = boardLimits.get(link.ticket.boardId)
    if (!Number.isInteger(number) || limit === undefined) {
      continue
    }
    const result = await prisma.$transaction((tx) =>
      applyTrigger(tx, link.ticketId, limit, {
        ...key,
        number,
        source: trigger.source,
        dedupeKey: trigger.dedupeKey,
        url: trigger.url ?? link.url,
        checks: trigger.checks ?? [],
        body: trigger.body ? trigger.body.slice(0, MAX_BODY_LENGTH) : null,
        author: trigger.author ?? null,
        reviewState: trigger.reviewState ?? null,
      }),
    )
    logger.info(
      { ticketId: link.ticketId, ...key, number, source: trigger.source, dedupeKey: trigger.dedupeKey, result },
      'agent auto revise',
    )
  }
}

/**
 * 未消化のきっかけがそろった(最後のきっかけから待ち時間が過ぎた)か。revise で拾うかの判定に使う。
 */
export const hasSettledAutoRevise = async (ticketId: string, now: Date = nowDate()): Promise<boolean> => {
  const { _max, _count } = await prisma.agentAutoReviseTrigger.aggregate({
    where: { ticketId, consumed: false },
    _max: { updatedAt: true },
    _count: { _all: true },
  })
  return _count._all > 0 && !!_max.updatedAt && _max.updatedAt <= msBefore(now, AUTO_REVISE_SETTLE_MS)
}

/** 実行の開始時に、未消化のきっかけをその実行で引き受ける。チケットの行ロックを取った後に呼ぶ */
export const consumeAutoReviseTriggers = async (tx: Db, ticketId: string, runId: string) =>
  tx.agentAutoReviseTrigger.updateMany({ where: { ticketId, consumed: false }, data: { runId, consumed: true } })

/** 担当が替わったら、前の担当へのきっかけを捨てる */
export const discardAutoReviseTriggers = async (tx: Db, ticketId: string) =>
  tx.agentAutoReviseTrigger.deleteMany({ where: { ticketId, consumed: false } })

/**
 * 実行中の実行が引き受けたきっかけ。revise で再開したエージェントへ `task.autoRevise` として渡す。
 */
export const listRunAutoRevise = async (runnerId: string, ticketId: string) => {
  const run = await prisma.agentRun.findFirst({
    where: { runnerId, ticketId, status: 'running' },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  })
  if (!run) {
    return []
  }
  const triggers = await prisma.agentAutoReviseTrigger.findMany({
    where: { runId: run.id },
    orderBy: { createdAt: 'asc' },
    select: {
      source: true,
      provider: true,
      repo: true,
      number: true,
      url: true,
      checks: true,
      body: true,
      author: true,
      reviewState: true,
    },
  })
  return triggers.map(({ source, provider, repo, number, url, checks, body, author, reviewState }) => ({
    source,
    pullRequest: { provider, repo, number },
    url,
    checks,
    review: source === 'review' ? { author, state: reviewState, body } : null,
  }))
}
