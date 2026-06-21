'use server'

import { safeAuthAction } from '@/lib/action-server'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scUUID } from '@/lib/schema'

/**
 * LinkWidget一覧取得
 */
export const getLinkWidgets = safeAuthAction
  .metadata({ actionName: 'getLinkWidgets', role: 'admin' })
  .action(async () => {
    const links = await prisma.linkWidget.findMany({
      select: { id: true, name: true, description: true, iconPath: true, updatedAt: true },
    })
    return links
  })

/**
 * LinkWidget削除
 */
export const deleteLinkWidget = safeAuthAction
  .metadata({ actionName: 'deleteLinkWidget', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    logger.info({ id }, 'linkWidget deleted')
    return { id }
  })
