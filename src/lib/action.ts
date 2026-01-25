import { createSafeActionClient } from 'next-safe-action'
import z from 'zod'
import { logger } from './logger'

export const safeAction = createSafeActionClient({
  defineMetadataSchema: () => z.object({ actionName: z.string() }),
  handleServerError: (error) => {
    logger.warn(error)
  },
}).use(async ({ next, clientInput, metadata }) => {
  logger.debug({ action: metadata.actionName, input: clientInput }, 'action start')
  const startTime = performance.now()
  const result = await next()
  const endTime = performance.now()
  logger.info({ action: metadata.actionName, execTime: `${(endTime - startTime).toFixed(2)} ms` }, 'action end')
  return result
})
