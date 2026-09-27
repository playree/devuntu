import { nowDate } from '@/lib/day'
import { verifyGithubSignature } from '@/lib/github/github-signature'
import { handleGithubEvent } from '@/lib/github/github-webhook'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { readLimitedBody } from '@/lib/request-body'
import { decryptSecret } from '@/lib/secret-crypto'
import { z } from 'zod'

/**
 * GitHub Webhook の受け口(PR の状態・CI の結果の反映と、マージによるチケットの自動完了)。
 *
 * `src/proxy.ts` は `api/` の認証を素通しにしているため未認証で叩ける。
 * シークレットは対応付けごとに違うので、URL の ID で対応付け(BoardRepository)を引き、そのシークレットで検証する。
 * GitHub が付ける署名だけが門番なので、検証を通す前に本文を解釈しないこと。
 */

/** 受け付ける本文の上限。GitHub は 25MB で配送を打ち切るが、扱うイベントの payload は数十KB に収まる */
const MAX_BODY_BYTES = 5 * 1024 * 1024

const zId = z.uuidv7()

export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (!zId.safeParse(id).success) {
    return new Response(null, { status: 404 })
  }

  const repository = await prisma.boardRepository.findFirst({
    where: { id, provider: 'github' },
    select: {
      repo: true,
      webhookSecret: true,
      board: { select: { id: true, key: true, completeOnPrMerge: true } },
    },
  })
  if (!repository) {
    return new Response(null, { status: 404 })
  }

  const rawBody = await readLimitedBody(request, MAX_BODY_BYTES)
  if (rawBody === null) {
    logger.warn({ repositoryId: id }, 'github webhook body too large')
    return new Response(null, { status: 413 })
  }

  const secret = repository.webhookSecret && (await decryptSecret(repository.webhookSecret))
  const valid =
    !!secret && verifyGithubSignature({ secret, signature: request.headers.get('x-hub-signature-256'), rawBody })
  if (!valid) {
    logger.warn({ repositoryId: id, hasSecret: !!secret }, 'github webhook signature mismatch')
    return new Response(null, { status: 401 })
  }

  await prisma.boardRepository.update({ where: { id }, data: { lastReceivedAt: nowDate() }, select: { id: true } })

  let body: unknown
  try {
    // Webhook の Content type は application/json で登録する(form 形式は受けない)
    body = JSON.parse(rawBody)
  } catch {
    return new Response(null, { status: 400 })
  }

  const event = request.headers.get('x-github-event') ?? ''
  const delivery = request.headers.get('x-github-delivery')
  logger.debug({ event, delivery, repositoryId: id }, 'github webhook')

  /**
   * GitHub の応答待ちは 10 秒あり、扱う処理は DB の更新だけなので応答の前に済ませる。
   * 失敗を 500 で返せば、GitHub の配送履歴から再送できる。
   */
  try {
    await handleGithubEvent(event, body, { id, repo: repository.repo, board: repository.board })
  } catch (error) {
    logger.error({ error, event, delivery, repositoryId: id }, 'github webhook failed')
    return new Response(null, { status: 500 })
  }
  return new Response(null, { status: 204 })
}
