/**
 * チケットの受け入れ条件(サーバー専用)
 *
 * 1項目ごとに「人の確認(checkedBy / checkedAt)」と「エージェントの自己申告(agentMet / agentEvidence)」を
 * 別々に持つ。どちらも項目の文言に対する判断なので、文言を変えた項目は両方とも未確認へ戻す。
 */

import { Prisma } from '@/generated/prisma/client'
import { nowDate } from '../day'
import { errInvalidOperation } from '../error'
import { prisma, type Db } from '../prisma'
import type { CriterionItem } from '../schema/schema-ticket'
import { assertTicketAccess, type Actor } from './board-access'

/** 画面・MCP で共通に返す項目 */
const criterionSelect = {
  id: true,
  text: true,
  checkedAt: true,
  checkedBy: { select: { name: true } },
  agentMet: true,
  agentEvidence: true,
  agentReportedAt: true,
} as const satisfies Prisma.TicketCriterionSelect

export const listTicketCriteria = async (ticketId: string, tx: Db = prisma) => {
  const rows = await tx.ticketCriterion.findMany({
    where: { ticketId },
    select: criterionSelect,
    orderBy: { order: 'asc' },
  })
  return rows.map(({ checkedBy, ...row }) => ({ ...row, checkedByName: checkedBy?.name ?? '' }))
}
export type TicketCriterionRow = Awaited<ReturnType<typeof listTicketCriteria>>[number]

/** 確認状態を未確認へ戻すときの値(人・エージェントの両方) */
const RESET_CHECKS = {
  checkedById: null,
  checkedAt: null,
  agentMet: null,
  agentEvidence: null,
  agentReportedAt: null,
} as const satisfies Prisma.TicketCriterionUncheckedUpdateInput

/**
 * 受け入れ条件を渡された一覧で置き換える。権限判定を済ませた後に同じトランザクション内で呼ぶ。
 *
 * id 付きの項目は既存の行を引き継ぎ(文言が変わったら確認状態をリセット)、id の無い項目は新規に作る。
 * 一覧に無い既存の行は消す。他のチケットの id が混ざっていたら throw する。
 * 戻り値は変更履歴に残す差分で、文言を変えた項目は removed / added の両方に入る。
 */
export const syncTicketCriteria = async (
  tx: Prisma.TransactionClient,
  ticketId: string,
  items: CriterionItem[],
): Promise<{ removed: string[]; added: string[] }> => {
  const existing = await tx.ticketCriterion.findMany({ where: { ticketId }, select: { id: true, text: true } })
  const textById = new Map(existing.map((row) => [row.id, row.text]))

  const keptIds = items.flatMap((item) => (item.id ? [item.id] : []))
  if (keptIds.some((id) => !textById.has(id)) || new Set(keptIds).size !== keptIds.length) {
    throw errInvalidOperation()
  }

  const removed = existing.filter((row) => !keptIds.includes(row.id)).map((row) => row.text)
  const added: string[] = []

  await tx.ticketCriterion.deleteMany({ where: { ticketId, id: { notIn: keptIds } } })
  for (const [order, item] of items.entries()) {
    if (!item.id) {
      await tx.ticketCriterion.create({ data: { ticketId, order, text: item.text } })
      added.push(item.text)
      continue
    }
    const previous = textById.get(item.id)
    const isTextChanged = previous !== item.text
    await tx.ticketCriterion.update({
      where: { id: item.id },
      data: { order, text: item.text, ...(isTextChanged && RESET_CHECKS) },
    })
    if (isTextChanged && previous !== undefined) {
      removed.push(previous)
      added.push(item.text)
    }
  }
  return { removed, added }
}

/** 人による確認の切り替え。チケットを編集できる人だけが行える */
export const checkTicketCriterion = async (actor: Actor, id: string, checked: boolean) =>
  prisma.$transaction(async (tx) => {
    const target = await tx.ticketCriterion.findUnique({ where: { id }, select: { ticketId: true } })
    if (!target) {
      throw errInvalidOperation()
    }
    await assertTicketAccess(actor, target.ticketId, 'edit', tx)

    await tx.ticketCriterion.update({
      where: { id },
      data: checked ? { checkedById: actor.id, checkedAt: nowDate() } : { checkedById: null, checkedAt: null },
    })
    return { id, ticketId: target.ticketId }
  })

export type AgentCriterionReport = { id: string; met: boolean; evidence: string }

/**
 * エージェントの自己申告の対象が、すべてそのチケットの項目かを確かめる。混ざっていたら throw する。
 * 実行を閉じる前に呼び、エージェントが id を直して呼び直せるようにする(`finishAgentTask`)。
 */
export const assertAgentCriteria = async (
  tx: Prisma.TransactionClient,
  ticketId: string,
  reports: AgentCriterionReport[],
): Promise<void> => {
  if (reports.length === 0) {
    return
  }
  const ids = reports.map((report) => report.id)
  const count = await tx.ticketCriterion.count({ where: { ticketId, id: { in: ids } } })
  if (count !== new Set(ids).size || count !== ids.length) {
    throw errInvalidOperation()
  }
}

/**
 * エージェントの自己申告を記録する。報告の無い項目は前回の申告のまま残す。
 * 対象の検証(`assertAgentCriteria`)を済ませた後に、実行を閉じるのと同じトランザクション内で呼ぶ。
 */
export const writeAgentCriteria = async (
  tx: Prisma.TransactionClient,
  reports: AgentCriterionReport[],
): Promise<void> => {
  const now = nowDate()
  for (const report of reports) {
    await tx.ticketCriterion.update({
      where: { id: report.id },
      data: { agentMet: report.met, agentEvidence: report.evidence, agentReportedAt: now },
    })
  }
}
