import { prisma } from './prisma'

/**
 * Key-Value Store Utility
 */

type KeyString =
  | 'DASHBOARD_DEFAULT_LAYOUT'
  | 'DASHBOARD_ANNOUNCEMENT'
  | 'GOOGLE_ACCOUNT_ENABLED'
  | 'GOOGLE_ACCOUNT_ALLOWED_GROUP_IDS'
  | 'SLACK_ENABLED'
  | 'SLACK_ALLOWED_GROUP_IDS'

/** キーをまとめて引くための名前空間(KeyValueStore.group) */
type KvsGroup = 'GOOGLE_ACCOUNT' | 'SLACK'

export const getString = async (key: KeyString) => {
  return prisma.keyValueStore.findUnique({ where: { key } })
}

export const setString = async (key: KeyString, value: string, group?: KvsGroup) => {
  return prisma.keyValueStore.upsert({
    where: { key },
    update: { value, group },
    create: { key, value, group },
  })
}

/**
 * 複数の key/value を単一トランザクションでまとめて保存する(全件コミット or 全件ロールバック)
 */
export const setStrings = async (entries: { key: KeyString; value: string; group?: KvsGroup }[]) => {
  return prisma.$transaction(
    entries.map(({ key, value, group }) =>
      prisma.keyValueStore.upsert({
        where: { key },
        update: { value, group },
        create: { key, value, group },
      }),
    ),
  )
}

/**
 * 指定した group に属する key/value をまとめて取得しマップで返す
 */
export const getByGroup = async (group: KvsGroup): Promise<Record<string, string>> => {
  const rows = await prisma.keyValueStore.findMany({
    where: { group },
    select: { key: true, value: true },
  })
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}
