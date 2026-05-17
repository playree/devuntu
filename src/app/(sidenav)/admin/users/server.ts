'use server'

import { safeAuthAction } from '@/lib/action-server'
import { prisma } from '@/lib/prisma'

export const getUsers = safeAuthAction.metadata({ actionName: 'getUsers', role: 'admin' }).action(async () => {
  return prisma.user.findMany({ select: { id: true, name: true, email: true, lastLoginAt: true, createdAt: true } })
})
