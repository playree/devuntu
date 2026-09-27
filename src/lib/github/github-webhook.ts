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
import { nowDate } from '../day'
import { autoLinkPullRequest, type GitRepoKey, saveCheckSuite, syncPullRequest } from '../git/git-webhook'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { githubPullRequestUrl, pullRequestStateOf } from './github'

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
      where: { provider: 'github', baseUrl: '', repo },
      select: { board: { select: { id: true, key: true, completeOnPrMerge: true } } },
    })
  ).map(({ board }) => board)

/** GitHub のリポジトリの指定。インスタンスは github.com だけなので baseUrl は空 */
const repoKey = (repo: string): GitRepoKey => ({ provider: 'github', baseUrl: '', repo })

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

  const key = repoKey(repo)
  await autoLinkPullRequest({ key, number: pr.number, url: githubPullRequestUrl(repo, pr.number) }, pr.head.ref, boards)

  await syncPullRequest({
    key,
    boards,
    number: pr.number,
    state: { title: pr.title, prState: pullRequestStateOf(pr), headSha: pr.head.sha, syncedAt: pr.updated_at },
    // マージせずに閉じた場合も、残りの PR がマージ済みなら完了の条件を満たすので判定する
    isClosed: action === 'closed',
  })
}

/** Check Suite の状態を保存する。check_suite / check_run のどちらのイベントも同じ形の suite を持つ */
const saveGithubCheckSuite = async (
  repo: string,
  suite: z.infer<typeof scCheckSuite>,
  fallback: { status: string; app?: string },
) =>
  saveCheckSuite(
    { ...repoKey(repo), suiteId: String(suite.id), repositoryId: '' },
    {
      headSha: suite.head_sha,
      appName: suite.app?.name ?? fallback.app ?? '',
      status: suite.status ?? fallback.status,
      conclusion: suite.conclusion ?? null,
      syncedAt: suite.updated_at ?? nowDate(),
    },
  )

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
  await saveGithubCheckSuite(repo, parsed.data.check_suite, { status: 'completed' })
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
  await saveGithubCheckSuite(repo, run.check_suite, { status: 'in_progress', app: run.app?.name })
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
