/**
 * ボードの Git 連携(GitHub / GitLab のリポジトリの対応付け・マージで完了)の設定(サーバー専用)
 *
 * `/boards/[id]/settings` の Server Action から呼ぶ。設定できるのは owner と管理者。
 * Webhook は対応付けたリポジトリのイベントだけを扱うので、ここがボードごとの受け入れ範囲になる。
 *
 * Webhook のシークレット(GitHub)/ トークン(GitLab)は対応付けごとに暗号化して保存し、
 * 受け口の URL に対応付けの ID を含めて、どのシークレットで検証するかを決める。
 * 対応付けごとに別のシークレットにするので、作り直しても他のボード・リポジトリの Webhook に影響しない。
 */

import type { GitProvider, GitWebhookAuth } from '@/generated/prisma/enums'
import { randomBytes } from 'node:crypto'
import { envu } from '../env-util'
import { errInvalidOperation, errValidation } from '../error'
import { githubWebhookPath, normalizeGithubRepo } from '../github/github'
import { gitlabWebhookPath, normalizeGitlabProjectPath } from '../gitlab/gitlab'
import { isValidGitlabSigningToken } from '../gitlab/gitlab-signature'
import { logger } from '../logger'
import { type Db, prisma } from '../prisma'
import { encryptSecret } from '../secret-crypto'
import { makeUrl } from '../server-utils'
import { type Actor, assertBoardAccess } from './board-access'

/** 1ボードに対応付けられるリポジトリの上限(GitHub / GitLab の合計) */
export const MAX_BOARD_REPOSITORIES = 20

/**
 * GitLab 連携で使ってよいインスタンスの URL。空なら GitLab 連携ごと無効。
 * 読めない値が混ざっていたら GitLab 連携だけを止める(GitHub の紐付けやボード設定まで巻き込まない)。
 */
export const gitlabBaseUrls = (): string[] => {
  try {
    return envu.server.GITLAB_URLS
  } catch (error) {
    logger.error({ error }, 'GITLAB_URLS is invalid. GitLab integration is disabled')
    return []
  }
}

/**
 * 現在の設定と、GitHub / GitLab 側へ登録する Webhook の URL。シークレットそのものは画面へ返さない(設定済みかどうかだけ)。
 * GitLab は使えない環境なら null。ただし対応付けが残っていれば、外せるよう一覧だけは返す(enabled=false)
 */
export const getBoardGit = async (actor: Actor, boardId: string) => {
  await assertBoardAccess(actor, boardId, 'manage')

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      completeOnPrMerge: true,
      repositories: {
        select: {
          id: true,
          provider: true,
          baseUrl: true,
          repo: true,
          webhookAuth: true,
          webhookSecret: true,
          lastReceivedAt: true,
        },
        orderBy: [{ baseUrl: 'asc' }, { repo: 'asc' }],
      },
    },
  })
  if (!board) {
    throw errInvalidOperation()
  }

  const githubRepositories = board.repositories.filter(({ provider }) => provider === 'github')
  const gitlabRepositories = board.repositories.filter(({ provider }) => provider === 'gitlab')
  const instances = gitlabBaseUrls()

  const github = {
    repositories: githubRepositories.map(({ id, repo, webhookSecret, lastReceivedAt }) => ({
      id,
      repo,
      webhookUrl: makeUrl(githubWebhookPath(id)).toString(),
      hasSecret: !!webhookSecret,
      lastReceivedAt,
    })),
  }
  const gitlab =
    instances.length > 0 || gitlabRepositories.length > 0
      ? {
          enabled: instances.length > 0,
          instances,
          repositories: gitlabRepositories.map(({ id, baseUrl, repo, webhookAuth, webhookSecret, lastReceivedAt }) => ({
            id,
            baseUrl,
            repo,
            webhookUrl: makeUrl(gitlabWebhookPath(id)).toString(),
            webhookAuth: webhookAuth ?? 'signing',
            hasSecret: !!webhookSecret,
            lastReceivedAt,
          })),
        }
      : null

  return { completeOnPrMerge: board.completeOnPrMerge, github, gitlab }
}

const assertRepositoryLimit = async (tx: Db, boardId: string) => {
  if ((await tx.boardRepository.count({ where: { boardId } })) >= MAX_BOARD_REPOSITORIES) {
    throw errInvalidOperation()
  }
}

/** Webhook のシークレット(GitHub)/ シークレットトークン(GitLab)。推測されないよう十分な長さの乱数にする */
const generateWebhookToken = (): string => randomBytes(32).toString('base64url')

/**
 * GitHub のリポジトリを対応付け、Webhook のシークレットを作って1回だけ返す(平文はこの応答でしか受け取れない)。
 * 登録済みなら何もしない(二度押しで失敗させず、シークレットも作り直さない)。
 */
export const addBoardGithubRepository = async (actor: Actor, boardId: string, rawRepo: string) => {
  const repo = normalizeGithubRepo(rawRepo)
  if (!repo) {
    throw errValidation('repo')
  }
  const token = generateWebhookToken()
  const webhookSecret = await encryptSecret(token)

  const result = await prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, boardId, 'manage', tx)
    const key = { boardId, provider: 'github' as const, baseUrl: '', repo }
    const existing = await tx.boardRepository.findUnique({
      where: { boardId_provider_baseUrl_repo: key },
      select: { id: true },
    })
    if (existing) {
      return { id: existing.id, token: null, isExisting: true }
    }
    await assertRepositoryLimit(tx, boardId)
    const created = await tx.boardRepository.create({ data: { ...key, webhookSecret }, select: { id: true } })
    return { id: created.id, token, isExisting: false }
  })

  if (!result.isExisting) {
    logger.info({ userId: actor.id, boardId, repo }, 'board repository added')
  }
  return { ...result, repo, webhookUrl: makeUrl(githubWebhookPath(result.id)).toString() }
}

/**
 * GitLab のプロジェクトを対応付ける。
 *
 * - 署名トークン: トークンは GitLab が Webhook の作成時に作るので、ここでは作らない。
 *   Webhook URL を GitLab に登録した後、できたトークンを setGitlabSigningToken で保存してもらう
 * - シークレットトークン: devuntu がトークンを作って1回だけ返す(平文はこの応答でしか受け取れない)
 *
 * 登録済みなら何もしない(トークンも作り直さない)。検証方式も変えないので、保存済みの方式を返して画面で知らせる。
 */
export const addBoardGitlabRepository = async (
  actor: Actor,
  boardId: string,
  { baseUrl, project, webhookAuth }: { baseUrl: string; project: string; webhookAuth: GitWebhookAuth },
) => {
  if (!gitlabBaseUrls().includes(baseUrl)) {
    throw errValidation('baseUrl')
  }
  const repo = normalizeGitlabProjectPath(project, baseUrl)
  if (!repo) {
    throw errValidation('project')
  }
  const token = webhookAuth === 'token' ? generateWebhookToken() : null
  const webhookSecret = token && (await encryptSecret(token))

  const result = await prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, boardId, 'manage', tx)
    const key = { boardId, provider: 'gitlab' as const, baseUrl, repo }
    const existing = await tx.boardRepository.findUnique({
      where: { boardId_provider_baseUrl_repo: key },
      select: { id: true, webhookAuth: true },
    })
    if (existing) {
      return { id: existing.id, token: null, webhookAuth: existing.webhookAuth ?? 'signing', isExisting: true }
    }
    await assertRepositoryLimit(tx, boardId)
    const created = await tx.boardRepository.create({
      data: { ...key, webhookAuth, webhookSecret },
      select: { id: true },
    })
    return { id: created.id, token, webhookAuth, isExisting: false }
  })

  if (!result.isExisting) {
    logger.info({ userId: actor.id, boardId, baseUrl, repo, webhookAuth }, 'board repository added')
  }
  return { ...result, repo, webhookUrl: makeUrl(gitlabWebhookPath(result.id)).toString() }
}

/** 対応付けの Webhook のシークレットを保存する(別のボードの行を触れないよう boardId も条件に含める) */
const saveWebhookSecret = async (
  actor: Actor,
  { boardId, repositoryId, provider }: { boardId: string; repositoryId: string; provider: GitProvider },
  data: { webhookAuth?: GitWebhookAuth; webhookSecret: string },
) => {
  await prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, boardId, 'manage', tx)
    const { count } = await tx.boardRepository.updateMany({ where: { id: repositoryId, boardId, provider }, data })
    if (count === 0) {
      throw errInvalidOperation()
    }
  })
  logger.info(
    { userId: actor.id, boardId, repositoryId, provider, webhookAuth: data.webhookAuth },
    'webhook secret saved',
  )
}

/**
 * GitHub の Webhook のシークレットを作り直して1回だけ返す。
 * 作り直すと古いシークレットは使えなくなるので、GitHub 側の設定も入れ直してもらう。
 */
export const regenerateGithubSecret = async (actor: Actor, boardId: string, repositoryId: string) => {
  const token = generateWebhookToken()
  await saveWebhookSecret(
    actor,
    { boardId, repositoryId, provider: 'github' },
    { webhookSecret: await encryptSecret(token) },
  )
  return { token }
}

/** GitLab が作った署名トークン(`whsec_...`)を保存する。シークレットトークン方式からの切り替えにも使う */
export const setGitlabSigningToken = async (actor: Actor, boardId: string, repositoryId: string, secret: string) => {
  const value = secret.trim()
  if (!isValidGitlabSigningToken(value)) {
    throw errValidation('secret')
  }
  await saveWebhookSecret(
    actor,
    { boardId, repositoryId, provider: 'gitlab' },
    {
      webhookAuth: 'signing',
      webhookSecret: await encryptSecret(value),
    },
  )
}

/**
 * シークレットトークンを作り直して1回だけ返す。署名トークン方式からの切り替えにも使う。
 * 作り直すと古いトークンは使えなくなるので、GitLab 側の設定も入れ直してもらう。
 */
export const regenerateGitlabToken = async (actor: Actor, boardId: string, repositoryId: string) => {
  const token = generateWebhookToken()
  await saveWebhookSecret(
    actor,
    { boardId, repositoryId, provider: 'gitlab' },
    {
      webhookAuth: 'token',
      webhookSecret: await encryptSecret(token),
    },
  )
  return { token }
}

export const removeBoardRepository = async (actor: Actor, boardId: string, repositoryId: string) => {
  await prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, boardId, 'manage', tx)
    // 別のボードの行を消せないよう boardId も条件に含める
    await tx.boardRepository.deleteMany({ where: { id: repositoryId, boardId } })
  })

  logger.info({ userId: actor.id, boardId, repositoryId }, 'board repository removed')
}

export const setBoardCompleteOnPrMerge = async (actor: Actor, boardId: string, completeOnPrMerge: boolean) => {
  await prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, boardId, 'manage', tx)
    await tx.board.update({ where: { id: boardId }, data: { completeOnPrMerge }, select: { id: true } })
  })

  logger.info({ userId: actor.id, boardId, completeOnPrMerge }, 'board complete on pr merge updated')
}
