import { prisma } from './prisma'

/**
 * Key-Value Store Utility
 */

type KeyString = 'DASHBOARD_DEFAULT_LAYOUT' | 'DASHBOARD_ANNOUNCEMENT'

export const getString = async (key: KeyString) => {
  return prisma.keyValueStore.findUnique({ where: { key } })
}

export const setString = async (key: KeyString, value: string) => {
  return prisma.keyValueStore.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}
