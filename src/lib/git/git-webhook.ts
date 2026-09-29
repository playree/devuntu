/**
 * GitHub / GitLab の Webhook で共通の処理(サーバー専用)
 *
 * ブランチ名からの自動紐付け、CI の状態(GitCheckSuite)の保存、マージによるチケットの自動完了。
 * どのイベントを扱うか・どのボードが対象かは、provider ごとの Webhook 処理で決めてから呼ぶ。
 */

import type { GitProvider, PullRequestState } from '@/generated/prisma/enums'
import { isFailedConclusion, requestAutoRevise } from '../agent/agent-auto-revise'
import { gitlabBaseUrls } from '../board/board-repository'
import { completeTicketByMerge } from '../board/ticket-mutation'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { extractDisplayIdFromBranch, isAllPullRequestsDone, pullRequestLabel } from './git'

/** リポジトリの指定(provider + インスタンス + パス) */
export type GitRepoKey = { provider: GitProvider; baseUrl: string; repo: string }

/**
 * Webhook を受けられる対応付けか。GITLAB_URLS から外したインスタンスの
 * リポジトリは状態が更新されなくなるので、マージで完了の判定から外す(残ったリンクが判定を塞がないように)。
 */
const isReceivable = ({ provider, baseUrl }: GitRepoKey, baseUrls: string[]): boolean =>
  provider === 'github' || baseUrls.includes(baseUrl)

/** イベントの対象にするボード */
export type GitLinkedBoard = {
  id: string
  key: string
  completeOnPrMerge: boolean
  /** CI の失敗・レビュー指摘でエージェントへ自動差し戻しするか */
  autoRevise: boolean
  autoReviseLimit: number
}

/**
 * ブランチ名の表示IDからチケットを引き、PR / MR のリンクが無ければ作る。
 * 表示IDのキーが対応付けたボードのキーと一致するときだけ紐付ける(他のボードのチケットへは付けない)。
 * 外された(dismissed)リンクも行が残っているので、ここでは作り直さない。
 */
export const autoLinkPullRequest = async (
  { key, number, url }: { key: GitRepoKey; number: number; url: string },
  branch: string,
  boards: GitLinkedBoard[],
) => {
  const parsed = extractDisplayIdFromBranch(branch)
  const board = parsed && boards.find((board) => board.key === parsed.key)
  if (!parsed || !board) {
    return
  }
  const ticket = await prisma.ticket.findUnique({
    where: { boardId_number: { boardId: board.id, number: parsed.number } },
    select: { id: true },
  })
  if (!ticket) {
    return
  }

  const created = await prisma.ticketLink.createMany({
    data: { ticketId: ticket.id, ...key, kind: 'pull_request', ref: String(number), url, source: 'auto' },
    skipDuplicates: true,
  })
  if (created.count > 0) {
    logger.info({ ticketId: ticket.id, ...key, number }, 'pull request auto linked')
  }
}

/**
 * マージで完了にするボードのチケットのうち、紐付いた PR / MR がすべて片付いた(1件以上マージされた)ものを完了にする。
 *
 * 判定に使うのは、そのボードに対応付けたリポジトリ(provider を問わない)の PR / MR だけ。対応付けていない
 * リポジトリの PR には Webhook が届かず状態が空のままなので、含めるといつまでも完了にならない。外したリンクも含めない。
 */
export const completeMergedTickets = async (targets: { ticketId: string; boardId: string }[], pullRequest: string) => {
  for (const { ticketId, boardId } of targets) {
    const baseUrls = gitlabBaseUrls()
    const repositories = (
      await prisma.boardRepository.findMany({
        where: { boardId },
        select: { provider: true, baseUrl: true, repo: true },
      })
    ).filter((repository) => isReceivable(repository, baseUrls))
    if (repositories.length === 0) {
      continue
    }
    const links = await prisma.ticketLink.findMany({
      where: { ticketId, kind: 'pull_request', dismissed: false, OR: repositories },
      select: { prState: true },
    })
    if (!isAllPullRequestsDone(links.map(({ prState }) => prState))) {
      continue
    }
    if (await completeTicketByMerge(ticketId, pullRequest)) {
      logger.info({ ticketId, pullRequest }, 'ticket completed by merge')
    }
  }
}

/**
 * PR / MR の状態をリンクへ反映し、閉じられたならマージで完了にするか判定する。
 *
 * provider 側の更新時刻(秒単位)を保存しておき、それより古いイベントでは更新しない。
 * 同じ時刻ならマージが勝つ(マージの後に届いた同時刻の古い状態で戻さない)。
 */
export const syncPullRequest = async ({
  key,
  boards,
  number,
  state,
  isClosed,
}: {
  key: GitRepoKey
  boards: GitLinkedBoard[]
  number: number
  state: { title: string; prState: PullRequestState; headSha: string | null; syncedAt: Date }
  /** 閉じられた(マージ / クローズ)イベントか */
  isClosed: boolean
}) => {
  const where = {
    ...key,
    kind: 'pull_request' as const,
    ref: String(number),
    ticket: { boardId: { in: boards.map(({ id }) => id) } },
  }
  const { prState, syncedAt } = state
  const newer =
    prState === 'merged'
      ? [{ syncedAt: null }, { syncedAt: { lte: syncedAt } }]
      : [{ syncedAt: null }, { syncedAt: { lt: syncedAt } }, { syncedAt, prState: { not: 'merged' as const } }]
  // head が届かないイベントでは、保存済みの head(CI の突き合わせ先)を消さない
  await prisma.ticketLink.updateMany({
    where: { ...where, OR: newer },
    data: { ...state, headSha: state.headSha ?? undefined },
  })

  if (!isClosed) {
    return
  }
  const completeBoardIds = boards.filter(({ completeOnPrMerge }) => completeOnPrMerge).map(({ id }) => id)
  if (completeBoardIds.length === 0) {
    return
  }
  const targets = await prisma.ticketLink.findMany({
    where: { ...where, dismissed: false, ticket: { boardId: { in: completeBoardIds }, status: { not: 'done' } } },
    select: { ticketId: true, ticket: { select: { boardId: true } } },
  })
  await completeMergedTickets(
    targets.map(({ ticketId, ticket }) => ({ ticketId, boardId: ticket.boardId })),
    pullRequestLabel(key.provider, key.repo, number),
  )
}

export type CheckSuiteData = {
  headSha: string
  appName: string
  /** queued / in_progress / completed など(GitHub の Check Suite の形) */
  status: string
  conclusion: string | null
  /** provider 側の更新時刻。これより古いイベントでは更新しない */
  syncedAt: Date
}

/**
 * CI の状態を保存する。
 *
 * 更新時刻は秒単位なので、同じ時刻のイベントが前後して届くことがある。
 * 同じ時刻なら完了が勝つ(完了の後に届いた同時刻の途中経過で、実行中へ戻さない)。
 */
export const saveCheckSuite = async (
  key: GitRepoKey & {
    suiteId: string
    /** 受け取った対応付け(BoardRepository.id) */
    repositoryId: string
  },
  data: CheckSuiteData,
) => {
  const { syncedAt } = data
  const newer =
    data.status === 'completed'
      ? { syncedAt: { lte: syncedAt } }
      : { OR: [{ syncedAt: { lt: syncedAt } }, { syncedAt, status: { not: 'completed' } }] }
  const update = () => prisma.gitCheckSuite.updateMany({ where: { ...key, ...newer }, data })

  if ((await update()).count > 0) {
    return
  }
  // 無ければ作る。同時に届いたイベントに先を越された(重複で作れなかった)ら、その行と比べて更新し直す
  const created = await prisma.gitCheckSuite.createMany({ data: { ...key, ...data }, skipDuplicates: true })
  if (created.count === 0) {
    await update()
  }
}

/**
 * CI が失敗したら、その head を持つ PR / MR に紐付いたエージェントのチケットを差し戻す。
 * 同じ suite / パイプラインの失敗は1つのきっかけにまとめ、失敗したチェック名だけを足していく。
 */
export const reviseOnCheckFailure = async ({
  key,
  boards,
  suiteId,
  headSha,
  conclusion,
  checks,
}: {
  key: GitRepoKey
  boards: GitLinkedBoard[]
  suiteId: string
  headSha: string
  conclusion: string | null
  checks: string[]
}) => {
  if (!isFailedConclusion(conclusion)) {
    return
  }
  await requestAutoRevise(
    { key, boards, pullRequest: { headSha } },
    { source: 'ci', dedupeKey: `ci:${suiteId}`, checks },
  )
}
