'use server'

import { safeAuthAction } from '@/lib/action-server'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateGroup, scUpdateGroup, scUUID } from '@/lib/schema'

/**
 * グループ一覧取得
 */
export const getGroups = safeAuthAction.metadata({ actionName: 'getGroups', role: 'admin' }).action(async () => {
  const groups = await prisma.group.findMany({
    select: { id: true, name: true, description: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  return groups.map((group) => ({ ...group, description: group.description ?? '' }))
})
export type GetGroupsReturnType = Awaited<ReturnType<typeof getGroups>>['data']

/**
 * グループ作成
 */
export const createGroup = safeAuthAction
  .metadata({ actionName: 'createGroup', role: 'admin' })
  .inputSchema(scCreateGroup)
  .action(async ({ parsedInput: { name, description } }) => {
    const group = await prisma.group.create({
      data: { name, description },
      select: { id: true, name: true },
    })

    logger.info({ group }, 'group created')
    return group
  })

/**
 * グループ更新
 */
export const updateGroup = safeAuthAction
  .metadata({ actionName: 'updateGroup', role: 'admin' })
  .inputSchema(scUpdateGroup)
  .action(async ({ parsedInput: { id, name, description } }) => {
    const group = await prisma.$transaction(async (tx) => {
      // 対象の存在確認
      const target = await tx.group.findUnique({ where: { id }, select: { id: true } })
      if (!target) {
        throw errInvalidOperation()
      }

      return tx.group.update({
        where: { id },
        data: { name, description },
        select: { id: true, name: true },
      })
    })

    logger.info({ id }, 'group updated')
    return group
  })

/**
 * グループ削除
 */
export const deleteGroup = safeAuthAction
  .metadata({ actionName: 'deleteGroup', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    await prisma.$transaction(async (tx) => {
      // 対象の存在確認
      const target = await tx.group.findUnique({ where: { id }, select: { id: true } })
      if (!target) {
        throw errInvalidOperation()
      }

      // UserGroup は onDelete: Cascade で自動削除される
      await tx.group.delete({ where: { id } })
    })

    logger.info({ id }, 'group deleted')
    return { id }
  })
