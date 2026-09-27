/**
 * GitLab Webhook のイベント処理(サーバー専用)
 *
 * GitLab の Webhook は対応付け(BoardRepository)ごとに登録してもらい、受け口の URL で対応付けを決める
 * (トークンが Webhook ごとに違うため)。検証は受け口で済ませてから呼ぶ。扱うのはその対応付けの
 * ボードとプロジェクトだけで、別のプロジェクトのイベント(登録先の取り違え)は何もせず捨てる。
 *
 * GitLab も配送の順序を保証せず、再送もある。MR は updated_at、パイプラインはジョブの時刻を保存しておき、
 * それより古いイベントでは更新しない。
 */

import { z } from 'zod'
import { nowDate } from '../day'
import {
  autoLinkPullRequest,
  type GitLinkedBoard,
  type GitRepoKey,
  saveCheckSuite,
  syncPullRequest,
} from '../git/git-webhook'
import { logger } from '../logger'
import { gitlabMergeRequestUrl, mergeRequestStateOf, pipelineCheckStatusOf } from './gitlab'

/** Webhook の対象(受け口の URL が指す対応付け) */
export type GitlabWebhookTarget = {
  /** 対応付け(BoardRepository)の ID */
  id: string
  baseUrl: string
  repo: string
  board: GitLinkedBoard
}

/**
 * GitLab の日時。Webhook によって ISO 8601(`2026-09-27T10:00:00Z`)と
 * `2026-09-27 10:00:00 UTC` / `2026-09-27 19:00:00 +0900` の形が混ざる。読めなければ null。
 */
export const parseGitlabTime = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null
  }
  const legacy = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: (UTC|[+-]\d{2}:?\d{2}))?$/.exec(value.trim())
  const iso = legacy
    ? `${legacy[1]}T${legacy[2]}${!legacy[3] || legacy[3] === 'UTC' ? 'Z' : legacy[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')}`
    : value
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const zTime = z.string().nullish()

const scProject = z.object({ path_with_namespace: z.string().min(1) })

const scMergeRequestEvent = z.object({
  project: scProject,
  object_attributes: z.object({
    iid: z.number().int().positive(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean().nullish(),
    work_in_progress: z.boolean().nullish(),
    action: z.string().nullish(),
    updated_at: zTime,
    source_branch: z.string(),
    last_commit: z.object({ id: z.string() }).nullish(),
  }),
})

const scPipelineEvent = z.object({
  project: scProject,
  object_attributes: z.object({
    id: z.number().int(),
    sha: z.string().min(1),
    status: z.string(),
    created_at: zTime,
    finished_at: zTime,
  }),
  builds: z
    .array(z.object({ created_at: zTime, started_at: zTime, finished_at: zTime }))
    .nullish()
    .transform((builds) => builds ?? []),
})

/** 対応付けたプロジェクトのイベントか。違えば Webhook の登録先を取り違えている */
const isTargetProject = (target: GitlabWebhookTarget, project: { path_with_namespace: string }): boolean => {
  if (project.path_with_namespace.toLowerCase() === target.repo) {
    return true
  }
  logger.warn({ repo: target.repo, project: project.path_with_namespace }, 'gitlab webhook project mismatch')
  return false
}

const repoKey = ({ baseUrl, repo }: GitlabWebhookTarget): GitRepoKey => ({ provider: 'gitlab', baseUrl, repo })

const handleMergeRequest = async (body: unknown, target: GitlabWebhookTarget) => {
  const parsed = scMergeRequestEvent.safeParse(body)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'gitlab merge_request payload invalid')
    return
  }
  const { project, object_attributes: mr } = parsed.data
  if (!isTargetProject(target, project)) {
    return
  }

  const key = repoKey(target)
  const boards = [target.board]
  await autoLinkPullRequest(
    { key, number: mr.iid, url: gitlabMergeRequestUrl(target.baseUrl, target.repo, mr.iid) },
    mr.source_branch,
    boards,
  )

  await syncPullRequest({
    key,
    boards,
    number: mr.iid,
    state: {
      title: mr.title,
      prState: mergeRequestStateOf(mr),
      headSha: mr.last_commit?.id.toLowerCase() ?? null,
      syncedAt: parseGitlabTime(mr.updated_at) ?? nowDate(),
    },
    // 閉じた後の編集(ラベルの変更など)では判定しない。完了を手で戻したチケットを再び完了にしないため
    isClosed: mr.action === 'merge' || mr.action === 'close',
  })
}

/**
 * パイプラインの状態を Check Suite として保存する(suiteId = pipeline.id)。
 *
 * パイプラインには updated_at が無いので、ジョブの開始 / 終了時刻のうち最も新しいものを更新時刻にする。
 * ジョブの再実行で 失敗 → 実行中 に戻るのは正しい変化で、再実行したジョブの時刻が新しいので戻る。
 */
const handlePipeline = async (body: unknown, target: GitlabWebhookTarget) => {
  const parsed = scPipelineEvent.safeParse(body)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'gitlab pipeline payload invalid')
    return
  }
  const { project, object_attributes: pipeline, builds } = parsed.data
  if (!isTargetProject(target, project)) {
    return
  }

  const times = [
    pipeline.created_at,
    pipeline.finished_at,
    ...builds.flatMap(({ created_at, started_at, finished_at }) => [created_at, started_at, finished_at]),
  ]
    .map(parseGitlabTime)
    .filter((time): time is Date => time !== null)
  const syncedAt = times.length > 0 ? new Date(Math.max(...times.map((time) => time.getTime()))) : nowDate()

  await saveCheckSuite(
    { ...repoKey(target), suiteId: String(pipeline.id), repositoryId: target.id },
    { headSha: pipeline.sha.toLowerCase(), appName: 'GitLab CI', ...pipelineCheckStatusOf(pipeline.status), syncedAt },
  )
}

/** イベント(`X-Gitlab-Event`)ごとの処理。ここに無いイベント(Test / Push など)は受け取っても何もしない */
const HANDLERS = new Map<string, (body: unknown, target: GitlabWebhookTarget) => Promise<void>>([
  ['Merge Request Hook', handleMergeRequest],
  ['Pipeline Hook', handlePipeline],
])

export const handleGitlabEvent = async (event: string, body: unknown, target: GitlabWebhookTarget): Promise<void> => {
  const handler = HANDLERS.get(event)
  if (!handler) {
    return
  }
  await handler(body, target)
}
