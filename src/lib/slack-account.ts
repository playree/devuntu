/**
 * Slack 連携の可否設定・判定(サーバー専用)
 *
 * prisma / kvs / env-util に依存するため、クライアントからは import しないこと。
 * (クライアント安全な定数・型は `slack.ts` を参照)
 */

import { envu } from './env-util'
import { getByGroup, setStrings } from './kvs'
import { logger } from './logger'
import { prisma } from './prisma'

const KVS_GROUP = 'SLACK'
const KEY_ENABLED = 'SLACK_ENABLED'
const KEY_ALLOWED_GROUP_IDS = 'SLACK_ALLOWED_GROUP_IDS'

export type SlackSettings = {
  /** Slack 連携のグローバル有効化(デフォルト false) */
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
    logger.warn({ value }, 'invalid SLACK_ALLOWED_GROUP_IDS, fallback to []')
  }
  return []
}

/** 連携に必要な環境変数が揃っているか。1 つでも欠けると連携も送信も成立しない */
export const hasSlackCredentials = () =>
  !!envu.server.SLACK_CLIENT_ID && !!envu.server.SLACK_CLIENT_SECRET && !!envu.server.SLACK_BOT_TOKEN

/**
 * Slack 連携設定を取得する。
 * 未設定・パース不可の場合は無効(enabled=false, allowedGroupIds=[])を返す。
 */
export const getSlackSettings = async (): Promise<SlackSettings> => {
  const store = await getByGroup(KVS_GROUP)
  return {
    enabled: store[KEY_ENABLED] === 'true',
    allowedGroupIds: parseAllowedGroupIds(store[KEY_ALLOWED_GROUP_IDS]),
  }
}

/**
 * Slack 連携設定を保存する。
 */
export const setSlackSettings = async ({ enabled, allowedGroupIds }: SlackSettings): Promise<void> => {
  await setStrings([
    { key: KEY_ENABLED, value: enabled ? 'true' : 'false', group: KVS_GROUP },
    { key: KEY_ALLOWED_GROUP_IDS, value: JSON.stringify(allowedGroupIds), group: KVS_GROUP },
  ])
  logger.info({ enabled, allowedGroupIds }, 'slack settings updated')
}

/**
 * 通知の宛先候補を、Slack 連携を利用できるユーザーだけに絞る(判定の単一ソース)。
 *
 * 1 ユーザーずつ判定すると宛先の数だけ問い合わせが増えるため、こちらを本体にして
 * `canUseSlackAccount` はその薄いラッパにしてある。
 */
export const filterSlackAllowedUserIds = async (userIds: string[]): Promise<string[]> => {
  if (userIds.length === 0 || !hasSlackCredentials()) {
    return []
  }

  const { enabled, allowedGroupIds } = await getSlackSettings()
  if (!enabled) {
    return []
  }
  if (allowedGroupIds.length === 0) {
    return userIds
  }

  const memberships = await prisma.userGroup.findMany({
    where: { userId: { in: userIds }, groupId: { in: allowedGroupIds } },
    select: { userId: true },
  })
  const allowed = new Set(memberships.map(({ userId }) => userId))
  return userIds.filter((userId) => allowed.has(userId))
}

/**
 * 指定ユーザーが Slack 連携を利用できるかを判定する。
 */
export const canUseSlackAccount = async (userId: string): Promise<boolean> => {
  const allowed = await filterSlackAllowedUserIds([userId])
  return allowed.length > 0
}
