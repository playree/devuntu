import { createSafeActionClient } from 'next-safe-action'
import z from 'zod'
import { ClientError } from './error'
import { logger } from './logger'

export const safeAction = createSafeActionClient({
  defineMetadataSchema: () => z.object({ actionName: z.string() }),
  handleServerError: (error) => {
    if (error instanceof ClientError) {
      // クライアントエラー系
      // logger.warn(error.message)
      return {
        type: error.errorType,
        message: error.message,
      }
    }

    // システムエラー系
    logger.error(error)
    return {
      type: 'SYSTEM_ERROR',
      message: error.message,
    }
  },
}).use(async ({ next, clientInput, metadata }) => {
  logger.debug({ action: metadata.actionName, input: clientInput }, 'action start')
  const startTime = performance.now()
  const res = await next()
  const endTime = performance.now()
  if (!res.success) {
    logger.warn({ action: metadata.actionName, res }, 'action failed')
  }
  logger.info({ action: metadata.actionName, execTime: `${(endTime - startTime).toFixed(2)} ms` }, 'action end')
  return res
})
