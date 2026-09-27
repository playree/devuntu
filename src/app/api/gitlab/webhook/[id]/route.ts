import { gitlabBaseUrls } from '@/lib/board/board-repository'
import { nowDate } from '@/lib/day'
import { verifyGitlabSignature, verifyGitlabToken } from '@/lib/gitlab/gitlab-signature'
import { handleGitlabEvent } from '@/lib/gitlab/gitlab-webhook'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { readLimitedBody } from '@/lib/request-body'
import { decryptSecret } from '@/lib/secret-crypto'
import { z } from 'zod'

/**
 * GitLab Webhook の受け口(MR の状態・パイプラインの結果の反映と、マージによるチケットの自動完了)。
 *
 * `src/proxy.ts` は `api/` の認証を素通しにしているため未認証で叩ける。
 * トークンは Webhook ごとに違うので、URL の ID で対応付け(BoardRepository)を引き、そのトークンで検証する。
 * 検証を通す前に本文を解釈しないこと。
 *
 * GitLab は 4xx / 5xx が続くと Webhook を止めるので、検証を通ったリクエストには、扱わないイベントでも 2xx を返す。
 */

/** 受け付ける本文の上限。扱うイベントの payload は数十KB〜数百KB(ジョブの多いパイプライン)に収まる */
const MAX_BODY_BYTES = 5 * 1024 * 1024

const zId = z.uuidv7()

export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const baseUrls = gitlabBaseUrls()
  const { id } = await params
  if (baseUrls.length === 0 || !zId.safeParse(id).success) {
    // 未設定ならこの機能ごと無効。エンドポイントの存在も伏せる
    return new Response(null, { status: 404 })
  }

  const repository = await prisma.boardRepository.findFirst({
    where: { id, provider: 'gitlab' },
    select: {
      baseUrl: true,
      repo: true,
      webhookAuth: true,
      webhookSecret: true,
      board: { select: { id: true, key: true, completeOnPrMerge: true } },
    },
  })
  // GITLAB_URLS から外したインスタンスの対応付けは、行が残っていても受けない
  if (!repository || !baseUrls.includes(repository.baseUrl)) {
    return new Response(null, { status: 404 })
  }

  const rawBody = await readLimitedBody(request, MAX_BODY_BYTES)
  if (rawBody === null) {
    logger.warn({ repositoryId: id }, 'gitlab webhook body too large')
    return new Response(null, { status: 413 })
  }

  const secret = repository.webhookSecret && (await decryptSecret(repository.webhookSecret))
  const { headers } = request
  const valid =
    !!secret &&
    (repository.webhookAuth === 'token'
      ? verifyGitlabToken({ secret, token: headers.get('x-gitlab-token') })
      : // 署名トークンの対応付けでは X-Gitlab-Token だけのリクエストを受けない(弱い方式へ下げさせない)
        verifyGitlabSignature({
          secret,
          id: headers.get('webhook-id'),
          timestamp: headers.get('webhook-timestamp'),
          signature: headers.get('webhook-signature'),
          rawBody,
          now: nowDate().getTime(),
        }))
  if (!valid) {
    logger.warn({ repositoryId: id, hasSecret: !!secret }, 'gitlab webhook verification failed')
    return new Response(null, { status: 401 })
  }

  await prisma.boardRepository.update({ where: { id }, data: { lastReceivedAt: nowDate() }, select: { id: true } })

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return new Response(null, { status: 400 })
  }

  const event = headers.get('x-gitlab-event') ?? ''
  const delivery = headers.get('webhook-id') ?? headers.get('x-gitlab-event-uuid')
  logger.debug({ event, delivery, repositoryId: id }, 'gitlab webhook')

  /**
   * 扱う処理は DB の更新だけなので応答の前に済ませる。
   * 失敗を 500 で返せば、GitLab の Webhook の履歴(Recent events)から再送できる。
   */
  try {
    await handleGitlabEvent(event, body, {
      id,
      baseUrl: repository.baseUrl,
      repo: repository.repo,
      board: repository.board,
    })
  } catch (error) {
    logger.error({ error, event, delivery, repositoryId: id }, 'gitlab webhook failed')
    return new Response(null, { status: 500 })
  }
  return new Response(null, { status: 204 })
}
