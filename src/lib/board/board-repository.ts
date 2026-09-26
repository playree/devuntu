/**
 * ボードの GitHub 連携(リポジトリの対応付け・マージで完了)の設定(サーバー専用)
 *
 * `/boards/[id]/settings` の Server Action から呼ぶ。設定できるのは owner と管理者。
 * Webhook は対応付けたリポジトリのイベントだけを扱うので、ここがボードごとの受け入れ範囲になる。
 */

import { envu } from '../env-util'
import { errInvalidOperation, errValidation } from '../error'
import { GITHUB_WEBHOOK_PATH, normalizeGithubRepo } from '../github/github'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { makeUrl } from '../server-utils'
import { type Actor, assertBoardAccess } from './board-access'

/** 1ボードに対応付けられるリポジトリの上限 */
export const MAX_BOARD_REPOSITORIES = 20

/** GitHub 連携が使える環境か。署名シークレットが無ければ Webhook を受けられない */
export const isGithubEnabled = (): boolean => !!envu.server.GITHUB_WEBHOOK_SECRET

/** 現在の設定と、GitHub 側へ登録する Webhook の URL */
export const getBoardGithub = async (actor: Actor, boardId: string) => {
  await assertBoardAccess(actor, boardId, 'manage')

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      completeOnPrMerge: true,
      repositories: { select: { id: true, repo: true }, orderBy: { repo: 'asc' } },
    },
  })
  if (!board) {
    throw errInvalidOperation()
  }
  return {
    webhookUrl: makeUrl(GITHUB_WEBHOOK_PATH).toString(),
    completeOnPrMerge: board.completeOnPrMerge,
    repositories: board.repositories,
  }
}

export const addBoardRepository = async (actor: Actor, boardId: string, rawRepo: string) => {
  const repo = normalizeGithubRepo(rawRepo)
  if (!repo) {
    throw errValidation('repo')
  }

  await prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, boardId, 'manage', tx)
    if ((await tx.boardRepository.count({ where: { boardId } })) >= MAX_BOARD_REPOSITORIES) {
      throw errInvalidOperation()
    }
    // 登録済みなら何もしない(二度押しで失敗させない)
    await tx.boardRepository.upsert({
      where: { boardId_provider_repo: { boardId, provider: 'github', repo } },
      create: { boardId, provider: 'github', repo },
      update: {},
    })
  })

  logger.info({ userId: actor.id, boardId, repo }, 'board repository added')
  return { repo }
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
