/**
 * GitHub Webhook のイベント処理(サーバー専用)
 *
 * GitHub の Webhook は対応付け(BoardRepository)ごとに登録してもらい、受け口の URL で対応付けを決める
 * (シークレットが対応付けごとに違うため)。署名の検証は受け口で済ませてから呼ぶ。扱うのはその対応付けの
 * ボードとリポジトリだけで、別のリポジトリのイベント(登録先の取り違えや Organization の Webhook)は何もせず捨てる。
 *
 * GitHub は配送の順序を保証せず、再送もある。PR / Check Suite の状態は GitHub 側の updated_at を
 * 保存しておき、それより古いイベントでは更新しない(同じイベントが何度届いても結果が変わらない)。
 */

import { z } from 'zod'
import { requestAutoRevise } from '../agent/agent-auto-revise'
import { nowDate } from '../day'
import {
  autoLinkPullRequest,
  type GitLinkedBoard,
  type GitRepoKey,
  reviseOnCheckFailure,
  saveCheckSuite,
  syncPullRequest,
} from '../git/git-webhook'
import { logger } from '../logger'
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
    name: z.string().nullish(),
    status: z.string(),
    conclusion: z.string().nullish(),
    app: z.object({ name: z.string() }).nullish(),
    check_suite: scCheckSuite,
  }),
})

const scPullRequestReviewEvent = z.object({
  action: z.string(),
  repository: scRepository,
  review: z.object({
    id: z.number().int(),
    state: z.string(),
    body: z.string().nullish(),
    html_url: z.string(),
    user: z.object({ login: z.string() }).nullish(),
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    user: z.object({ login: z.string() }).nullish(),
  }),
})

/** 差し戻しのきっかけにするレビューの状態。承認(approved)は含めない */
const REVISE_REVIEW_STATES = new Set(['changes_requested', 'commented'])

/** Webhook の対象(受け口の URL が指す対応付け) */
export type GithubWebhookTarget = {
  /** 対応付け(BoardRepository)の ID */
  id: string
  /** `owner/name`(小文字) */
  repo: string
  board: GitLinkedBoard
}

/** 対応付けたリポジトリのイベントか。GitHub は大文字小文字を区別しないので小文字で比べる */
const isTargetRepo = (repository: { full_name: string }, target: GithubWebhookTarget): boolean =>
  repository.full_name.toLowerCase() === target.repo

/** GitHub のリポジトリの指定。インスタンスは github.com だけなので baseUrl は空 */
const repoKey = (repo: string): GitRepoKey => ({ provider: 'github', baseUrl: '', repo })

const handlePullRequest = async (body: unknown, target: GithubWebhookTarget) => {
  const parsed = scPullRequestEvent.safeParse(body)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'github pull_request payload invalid')
    return
  }
  const { action, repository, pull_request: pr } = parsed.data
  if (!isTargetRepo(repository, target)) {
    return
  }

  const { repo } = target
  const boards = [target.board]
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
  target: GithubWebhookTarget,
  suite: z.infer<typeof scCheckSuite>,
  fallback: { status: string; app?: string },
) =>
  saveCheckSuite(
    { ...repoKey(target.repo), suiteId: String(suite.id), repositoryId: target.id },
    {
      headSha: suite.head_sha,
      appName: suite.app?.name ?? fallback.app ?? '',
      status: suite.status ?? fallback.status,
      conclusion: suite.conclusion ?? null,
      syncedAt: suite.updated_at ?? nowDate(),
    },
  )

const handleCheckSuite = async (body: unknown, target: GithubWebhookTarget) => {
  const parsed = scCheckSuiteEvent.safeParse(body)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'github check_suite payload invalid')
    return
  }
  if (!isTargetRepo(parsed.data.repository, target)) {
    return
  }
  const suite = parsed.data.check_suite
  await saveGithubCheckSuite(target, suite, { status: 'completed' })
  // check_run を購読していない Webhook でも差し戻せるよう、suite の失敗でもきっかけを作る(チェック名は無し)
  await reviseOnCheckFailure({
    key: repoKey(target.repo),
    boards: [target.board],
    suiteId: String(suite.id),
    headSha: suite.head_sha,
    conclusion: suite.conclusion ?? null,
    checks: [],
  })
}

/**
 * check_run は suite の途中経過(実行中)を知るために使う。
 * 実行のないアプリの suite は queued のまま完了しないので、check_suite の requested では作らず、
 * 実際に走った check_run を起点に作る(永遠に「実行中」と表示されるのを避ける)。
 */
const handleCheckRun = async (body: unknown, target: GithubWebhookTarget) => {
  const parsed = scCheckRunEvent.safeParse(body)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'github check_run payload invalid')
    return
  }
  const { repository, check_run: run } = parsed.data
  if (!isTargetRepo(repository, target)) {
    return
  }
  // suite 側の status が無いペイロードでは、run が終わっていても suite の完了は check_suite で受ける
  await saveGithubCheckSuite(target, run.check_suite, { status: 'in_progress', app: run.app?.name })
  if (run.status === 'completed') {
    await reviseOnCheckFailure({
      key: repoKey(target.repo),
      boards: [target.board],
      suiteId: String(run.check_suite.id),
      headSha: run.check_suite.head_sha,
      conclusion: run.conclusion ?? null,
      checks: run.name ? [run.name] : [],
    })
  }
}

/**
 * レビューの投稿。修正依頼と、CodeRabbit などのコメントのレビューを差し戻しのきっかけにする。
 * PR の作成者自身のレビュー(エージェントがスレッドへ返信したときに作られるもの)は除く。
 */
const handlePullRequestReview = async (body: unknown, target: GithubWebhookTarget) => {
  const parsed = scPullRequestReviewEvent.safeParse(body)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'github pull_request_review payload invalid')
    return
  }
  const { action, repository, review, pull_request: pr } = parsed.data
  const state = review.state.toLowerCase()
  if (action !== 'submitted' || !isTargetRepo(repository, target) || !REVISE_REVIEW_STATES.has(state)) {
    return
  }
  const author = review.user?.login ?? null
  if (author && author === pr.user?.login) {
    return
  }
  await requestAutoRevise(
    { key: repoKey(target.repo), boards: [target.board], pullRequest: { number: pr.number } },
    {
      source: 'review',
      dedupeKey: `review:${review.id}`,
      body: review.body,
      author,
      reviewState: state,
      url: review.html_url,
    },
  )
}

/** イベントごとの処理。ここに無いイベント(ping など)は受け取っても何もしない */
const HANDLERS = new Map<string, (body: unknown, target: GithubWebhookTarget) => Promise<void>>([
  ['pull_request', handlePullRequest],
  ['check_suite', handleCheckSuite],
  ['check_run', handleCheckRun],
  ['pull_request_review', handlePullRequestReview],
])

export const handleGithubEvent = async (event: string, body: unknown, target: GithubWebhookTarget): Promise<void> => {
  const handler = HANDLERS.get(event)
  if (!handler) {
    return
  }
  await handler(body, target)
}
