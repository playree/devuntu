import { isAPIError } from 'better-auth/api'
import { createMiddleware, createSafeActionClient } from 'next-safe-action'
import { headers } from 'next/headers'
import z from 'zod'
import { auth } from './auth'
import { ClientError, errInvalidSession, errPermissionDenied } from './error'
import { logger } from './logger'

const normalMetaSc = z.object({ actionName: z.string() })
type NormalMetaSc = z.infer<typeof normalMetaSc>

const authMetaSc = z.object({ actionName: z.string(), role: z.enum(['user', 'admin']) })
type AuthMetaSc = z.infer<typeof authMetaSc>

type ServerError = { name?: string; errorType: string; message: string }

/**
 * エラーハンドラー
 *
 * ClientError は errorType でクライアント側の分岐に使うため内容をそのまま返す。
 * better-auth の APIError も文言が利用者向けなのでそのまま返す。
 * それ以外(Prisma の制約名・接続情報・環境変数名などが混ざりうる)はログにだけ残し、
 * クライアントへは固定文言を返して内部情報を出さない。
 */
const handleServerError = (error: Error) => {
  if (error instanceof ClientError) {
    // クライアントエラー系
    logger.info(error)
    return {
      name: error.name,
      errorType: error.errorType,
      message: error.message,
    }
  }

  if (isAPIError(error)) {
    // better-auth 由来。固定文言に潰すと原因(SESSION_NOT_FRESH など)が追えなくなる
    logger.info(error)
    return {
      errorType: error.body?.code ?? 'AUTH_ERROR',
      message: error.body?.message ?? error.message,
    }
  }

  // システムエラー系
  logger.error(error)
  return {
    errorType: 'SYSTEM_ERROR',
    message: 'Internal Server Error',
  }
}

/**
 * 前後処理用Middleware
 */
const wrapMiddleware = createMiddleware<{
  serverError: ServerError
  ctx: object
  metadata: NormalMetaSc
}>().define(async ({ next, clientInput, metadata }) => {
  logger.debug({ metadata, input: clientInput }, 'action start')
  const { actionName: action } = metadata
  const startTime = performance.now()
  const res = await next()
  const endTime = performance.now()
  if (!res.success) {
    logger.warn({ action, res }, 'action failed')
  }
  logger.info({ action, execTime: `${(endTime - startTime).toFixed(2)} ms` }, 'action end')
  return res
})

/**
 * 認証用Middleware
 */
const authMiddleware = createMiddleware<{
  serverError: ServerError
  ctx: object
  metadata: AuthMetaSc
}>().define(async ({ next, metadata }) => {
  // logger.debug({ metadata, input: clientInput }, 'action auth')
  const { role } = metadata

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  // サインイン状態チェック
  if (!session?.user) {
    throw errInvalidSession()
  }

  // 管理者権限チェック
  if (role === 'admin' && session.user.role !== 'admin') {
    throw errPermissionDenied()
  }

  return next({ ctx: { user: session.user } })
})

/**
 * Action(認証なし)
 */
export const safeAction = createSafeActionClient({
  defineMetadataSchema: () => normalMetaSc,
  handleServerError,
}).use(wrapMiddleware)

/**
 * Action(認証あり)
 */
export const safeAuthAction = createSafeActionClient({
  defineMetadataSchema: () => authMetaSc,
  handleServerError,
})
  .use(wrapMiddleware)
  .use(authMiddleware)
