/**
 * Google アカウント連携の可否設定・判定(サーバー専用)
 *
 * prisma / kvs / env-util に依存するため、クライアントからは import しないこと。
 * (クライアント安全な定数・型は `google-calendar.ts` を参照)
 */

import { envu } from './env-util'
import { getByGroup, setStrings } from './kvs'
import { logger } from './logger'
import { prisma } from './prisma'

const KVS_GROUP = 'GOOGLE_ACCOUNT'
const KEY_ENABLED = 'GOOGLE_ACCOUNT_ENABLED'
const KEY_ALLOWED_GROUP_IDS = 'GOOGLE_ACCOUNT_ALLOWED_GROUP_IDS'

export type GoogleAccountSettings = {
  /** Google アカウント連携のグローバル有効化(デフォルト false) */
  enabled: boolean
  /** 利用を許可するグループID(空配列=全ユーザー許可) */
  allowedGroupIds: string[]
}

/** allowedGroupIds の JSON 文字列を安全に配列へパースする */
const parseAllowedGroupIds = (value: string | undefined): string[] => {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string')
    }
  } catch {
    logger.warn({ value }, 'invalid GOOGLE_ACCOUNT_ALLOWED_GROUP_IDS, fallback to []')
  }
  return []
}

/**
 * Google アカウント連携設定を取得する。
 * 未設定・パース不可の場合は無効(enabled=false, allowedGroupIds=[])を返す。
 */
export const getGoogleAccountSettings = async (): Promise<GoogleAccountSettings> => {
  const store = await getByGroup(KVS_GROUP)
  return {
    enabled: store[KEY_ENABLED] === 'true',
    allowedGroupIds: parseAllowedGroupIds(store[KEY_ALLOWED_GROUP_IDS]),
  }
}

/**
 * Google アカウント連携設定を保存する。
 */
export const setGoogleAccountSettings = async ({ enabled, allowedGroupIds }: GoogleAccountSettings): Promise<void> => {
  await setStrings([
    { key: KEY_ENABLED, value: enabled ? 'true' : 'false', group: KVS_GROUP },
    { key: KEY_ALLOWED_GROUP_IDS, value: JSON.stringify(allowedGroupIds), group: KVS_GROUP },
  ])
  logger.info({ enabled, allowedGroupIds }, 'google account settings updated')
}

/**
 * 指定ユーザーが Google アカウント連携を利用できるかを判定する(判定の単一ソース)。
 *
 * 1. GOOGLE_CLIENT_ID/SECRET が未設定 → 利用不可(そもそも連携できない)
 * 2. グローバル無効 → 利用不可
 * 3. 許可グループ未指定 → 全ユーザー許可
 * 4. 許可グループ指定あり → ユーザーの所属グループと交差があれば許可
 */
export const canUseGoogleAccount = async (userId: string): Promise<boolean> => {
  if (!envu.server.GOOGLE_CLIENT_ID || !envu.server.GOOGLE_CLIENT_SECRET) {
    return false
  }

  const { enabled, allowedGroupIds } = await getGoogleAccountSettings()
  if (!enabled) {
    return false
  }
  if (allowedGroupIds.length === 0) {
    return true
  }

  const membership = await prisma.userGroup.findFirst({
    where: { userId, groupId: { in: allowedGroupIds } },
    select: { id: true },
  })
  return !!membership
}
