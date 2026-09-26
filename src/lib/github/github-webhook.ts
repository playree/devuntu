/**
 * GitHub Webhook のイベント処理(サーバー専用)
 *
 * 署名の検証は受け口(`/api/github/webhook`)で済ませてから呼ぶ。扱うのはボードに対応付けた
 * リポジトリ(BoardRepository)のイベントだけで、対応付けの無いリポジトリのイベントは何もせず捨てる。
 *
 * GitHub は配送の順序を保証せず、再送もある。PR / Check Suite の状態は GitHub 側の updated_at を
 * 保存しておき、それより古いイベントでは更新しない(同じイベントが何度届いても結果が変わらない)。
 */

import { z } from 'zod'
import { completeTicketByMerge } from '../board/ticket-mutation'
import { nowDate } from '../day'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { extractDisplayIdFromBranch, githubPullRequestUrl, isAllPullRequestsDone, pullRequestStateOf } from './github'

const scRepository = z.object({ full_name: z.string().min(1) })

const scPullRequestEvent = z.object({
  action: z.string(),
  repository: scRepository,
  pull_request: z.object({
    number: z.number().int().positive(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean().optional(),
    merged: z.boolean().nullish(),
    updated_at: z.coerce.date(),
    head: z.object({ ref: z.string(), sha: z.string() }),
  }),
})

const scCheckSuite = z.object({
  id: z.number().int(),
  head_sha: z.string(),
  status: z.string().nullish(),
  conclusion: z.string().nullish(),
  updated_at: z.coerce.date().nullish(),
  app: z.object({ name: z.string() }).nullish(),
})

const scCheckSuiteEvent = z.object({ repository: scRepository, check_suite: scCheckSuite })

const scCheckRunEvent = z.object({
  repository: scRepository,
  check_run: z.object({
    status: z.string(),
    app: z.object({ name: z.string() }).nullish(),
    check_suite: scCheckSuite,
  }),
})

/** 対応付けたボード。対応付けが無ければ空で、そのリポジトリのイベントは扱わない */
const findLinkedBoards = async (repo: string) =>
  (
    await prisma.boardRepository.findMany({
      where: { provider: 'github', repo },
      select: { board: { select: { id: true, key: true, completeOnPrMerge: true } } },
    })
  ).map(({ board }) => board)

type LinkedBoard = Awaited<ReturnType<typeof findLinkedBoards>>[number]

/**
 * ブランチ名の表示IDからチケットを引き、PR のリンクが無ければ作る。
 * 表示IDのキーが対応付けたボードのキーと一致するときだけ紐付ける(他のボードのチケットへは付けない)。
 * 外された(dismissed)リンクも行が残っているので、ここでは作り直さない。
 */
const autoLinkPullRequest = async (repo: string, number: number, branch: string, boards: LinkedBoard[]) => {
  const parsed = extractDisplayIdFromBranch(branch)
  const board = parsed && boards.find(({ key }) => key === parsed.key)
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
    data: {
      ticketId: ticket.id,
      provider: 'github',
      kind: 'pull_request',
      repo,
      ref: String(number),
      url: githubPullRequestUrl(repo, number),
      source: 'auto',
    },
    skipDuplicates: true,
  })
  if (created.count > 0) {
    logger.info({ ticketId: ticket.id, repo, number }, 'github pull request auto linked')
  }
}

/**
 * マージで完了にするボードのチケットのうち、紐付いた PR がすべて片付いた(1件以上マージされた)ものを完了にする。
 *
 * 判定に使うのは、そのボードに対応付けたリポジトリの PR だけ。対応付けていないリポジトリの PR には
 * Webhook が届かず状態が空のままなので、含めるといつまでも完了にならない。外したリンクも含めない。
 */
const completeMergedTickets = async (targets: { ticketId: string; boardId: string }[], pullRequest: string) => {
  for (const { ticketId, boardId } of targets) {
    const repositories = await prisma.boardRepository.findMany({
      where: { boardId, provider: 'github' },
      select: { repo: true },
    })
    const links = await prisma.ticketLink.findMany({
      where: {
        ticketId,
        provider: 'github',
        kind: 'pull_request',
        dismissed: false,
        repo: { in: repositories.map(({ repo }) => repo) },
      },
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

const handlePullRequest = async (body: unknown) => {
  const parsed = scPullRequestEvent.safeParse(body)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'github pull_request payload invalid')
    return
  }
  const { action, repository, pull_request: pr } = parsed.data
  const repo = repository.full_name.toLowerCase()
  const boards = await findLinkedBoards(repo)
  if (boards.length === 0) {
    return
  }

  await autoLinkPullRequest(repo, pr.number, pr.head.ref, boards)

  const where = {
    provider: 'github' as const,
    repo,
    kind: 'pull_request' as const,
    ref: String(pr.number),
    ticket: { boardId: { in: boards.map(({ id }) => id) } },
  }
  const prState = pullRequestStateOf(pr)
  // updated_at は秒単位。同じ時刻ならマージが勝つ(マージの後に届いた同時刻の古い状態で戻さない)
  const newer =
    prState === 'merged'
      ? [{ syncedAt: null }, { syncedAt: { lte: pr.updated_at } }]
      : [
          { syncedAt: null },
          { syncedAt: { lt: pr.updated_at } },
          { syncedAt: pr.updated_at, prState: { not: 'merged' as const } },
        ]
  await prisma.ticketLink.updateMany({
    where: { ...where, OR: newer },
    data: { title: pr.title, prState, headSha: pr.head.sha, syncedAt: pr.updated_at },
  })

  // マージせずに閉じた場合も、残りの PR がマージ済みなら完了の条件を満たすので判定する
  if (action !== 'closed') {
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
    `${repo}#${pr.number}`,
  )
}

/** Check Suite の状態を保存する。check_suite / check_run のどちらのイベントも同じ形の suite を持つ */
const saveCheckSuite = async (
  repo: string,
  suite: z.infer<typeof scCheckSuite>,
  fallback: { status: string; app?: string },
) => {
  const syncedAt = suite.updated_at ?? nowDate()
  const data = {
    headSha: suite.head_sha,
    appName: suite.app?.name ?? fallback.app ?? '',
    status: suite.status ?? fallback.status,
    conclusion: suite.conclusion ?? null,
    syncedAt,
  }
  const key = { provider: 'github' as const, repo, suiteId: String(suite.id) }

  /**
   * GitHub の updated_at は秒単位なので、同じ時刻のイベントが前後して届くことがある。
   * 同じ時刻なら完了が勝つ(完了の後に届いた同時刻の途中経過で、実行中へ戻さない)。
   */
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

const handleCheckSuite = async (body: unknown) => {
  const parsed = scCheckSuiteEvent.safeParse(body)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'github check_suite payload invalid')
    return
  }
  const repo = parsed.data.repository.full_name.toLowerCase()
  if ((await findLinkedBoards(repo)).length === 0) {
    return
  }
  await saveCheckSuite(repo, parsed.data.check_suite, { status: 'completed' })
}

/**
 * check_run は suite の途中経過(実行中)を知るために使う。
 * 実行のないアプリの suite は queued のまま完了しないので、check_suite の requested では作らず、
 * 実際に走った check_run を起点に作る(永遠に「実行中」と表示されるのを避ける)。
 */
const handleCheckRun = async (body: unknown) => {
  const parsed = scCheckRunEvent.safeParse(body)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'github check_run payload invalid')
    return
  }
  const { repository, check_run: run } = parsed.data
  const repo = repository.full_name.toLowerCase()
  if ((await findLinkedBoards(repo)).length === 0) {
    return
  }
  // suite 側の status が無いペイロードでは、run が終わっていても suite の完了は check_suite で受ける
  await saveCheckSuite(repo, run.check_suite, { status: 'in_progress', app: run.app?.name })
}

/** イベントごとの処理。ここに無いイベント(ping など)は受け取っても何もしない */
const HANDLERS = new Map<string, (body: unknown) => Promise<void>>([
  ['pull_request', handlePullRequest],
  ['check_suite', handleCheckSuite],
  ['check_run', handleCheckRun],
])

export const handleGithubEvent = async (event: string, body: unknown): Promise<void> => {
  const handler = HANDLERS.get(event)
  if (!handler) {
    return
  }
  await handler(body)
}
