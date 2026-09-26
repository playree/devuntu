/**
 * チケットに紐付けたブランチ / PR / コミットの登録・削除・一覧(サーバー専用)
 *
 * Web(Server Action)と MCP の両方がここを通る。登録できるのはチケットを編集できる人で、
 * 権限の判定はコメントの投稿と同じ `assertTicketAccess(..., 'edit')` に揃える。
 */

import type { GitProvider } from '@/generated/prisma/enums'
import { errInvalidOperation, errValidation } from '../error'
import { type CiStatus, parseGithubUrl, summarizeCheckSuites } from '../github/github'
import { type Db, prisma } from '../prisma'
import { type Actor, assertTicketAccess } from './board-access'

/** 1チケットに紐付けられる上限。Webhook の自動紐付けとは別に、手での登録の暴走を止める */
export const MAX_TICKET_LINKS = 50

const LINK_SELECT = {
  id: true,
  provider: true,
  kind: true,
  repo: true,
  ref: true,
  url: true,
  title: true,
  prState: true,
  headSha: true,
  source: true,
  createdAt: true,
} as const

/**
 * 表示するリンク(外したものを除く)と CI の結果。
 * CI はリンクとは別に Check Suite として持っているので、headSha でまとめて引いて集計する。
 * 閲覧権限は呼び出し元(チケット詳細の取得)で確認済みであること。
 */
export const listTicketLinks = async (ticketId: string, db: Db = prisma) => {
  const links = await db.ticketLink.findMany({
    where: { ticketId, dismissed: false },
    select: LINK_SELECT,
    orderBy: { createdAt: 'asc' },
  })

  const targets = links.flatMap(({ provider, repo, headSha }) => (headSha ? [{ provider, repo, headSha }] : []))
  const suites =
    targets.length > 0
      ? await db.gitCheckSuite.findMany({
          where: { OR: targets },
          select: { provider: true, repo: true, headSha: true, status: true, conclusion: true },
        })
      : []

  const ciOf = (provider: GitProvider, repo: string, headSha: string | null): CiStatus | null =>
    headSha
      ? summarizeCheckSuites(
          suites.filter((suite) => suite.provider === provider && suite.repo === repo && suite.headSha === headSha),
        )
      : null

  return links.map(({ headSha, ...link }) => ({ ...link, ci: ciOf(link.provider, link.repo, headSha) }))
}
export type TicketLinkView = Awaited<ReturnType<typeof listTicketLinks>>[number]

/**
 * URL を渡してリンクを登録する。同じものが既にあれば、外していたものも含めて表示に戻す。
 * 種別(ブランチ / PR / コミット)は URL から判定する。
 */
export const addTicketLink = async (actor: Actor, ticketId: string, rawUrl: string) => {
  const artifact = parseGithubUrl(rawUrl)
  if (!artifact) {
    throw errValidation('url')
  }
  const { kind, repo, ref, url } = artifact

  return prisma.$transaction(async (tx) => {
    await assertTicketAccess(actor, ticketId, 'edit', tx)

    const key = { ticketId, provider: 'github' as const, repo, kind, ref }
    const existing = await tx.ticketLink.findUnique({
      where: { ticketId_provider_repo_kind_ref: key },
      select: { id: true },
    })
    if (existing) {
      return tx.ticketLink.update({ where: { id: existing.id }, data: { dismissed: false }, select: { id: true } })
    }

    if ((await tx.ticketLink.count({ where: { ticketId } })) >= MAX_TICKET_LINKS) {
      throw errInvalidOperation()
    }
    return tx.ticketLink.create({
      data: {
        ...key,
        url,
        // コミットは ref 自体が CI の突き合わせ先。PR は Webhook で head が届くまで空
        headSha: kind === 'commit' ? ref : null,
        source: 'manual',
        createdById: actor.id,
      },
      select: { id: true },
    })
  })
}

/**
 * リンクを外す。自動で付いたものは行を残して dismissed にし、次の Webhook で付け直さない。
 * 手で付けたものは消す(付け直すのも手なので、残しておく理由が無い)。
 */
export const removeTicketLink = async (actor: Actor, linkId: string) =>
  prisma.$transaction(async (tx) => {
    const link = await tx.ticketLink.findUnique({ where: { id: linkId }, select: { ticketId: true, source: true } })
    if (!link) {
      throw errInvalidOperation()
    }
    await assertTicketAccess(actor, link.ticketId, 'edit', tx)

    if (link.source === 'auto') {
      await tx.ticketLink.update({ where: { id: linkId }, data: { dismissed: true } })
    } else {
      await tx.ticketLink.delete({ where: { id: linkId } })
    }
    return { id: linkId, ticketId: link.ticketId }
  })
