/**
 * 外部サービス連携の可否設定・判定(サーバー専用)
 *
 * Google / Slack など、連携ごとに「グローバル有効化」と「利用を許可するグループ」を
 * KVS に持つ。形が同じなので読み書きと許可判定をここへ集約し、連携側は
 * `createIntegrationSettings` の呼び出しと公開名の付け替えだけで済むようにする。
 *
 * prisma / kvs に依存するため、クライアントからは import しないこと。
 */

import { getByGroup, KeyString, KvsGroup, setStrings } from './kvs'
import { logger } from './logger'
import { prisma } from './prisma'

export type IntegrationSettings = {
  /** 連携のグローバル有効化(デフォルト false) */
  enabled: boolean
  /** 利用を許可するグループID(空配列=全ユーザー許可) */
  allowedGroupIds: string[]
}

export const createIntegrationSettings = (config: {
  group: KvsGroup
  enabledKey: KeyString
  allowedGroupIdsKey: KeyString
  /** 連携に必要な環境変数が揃っているか。欠けていれば設定値に関わらず利用不可 */
  hasCredentials: () => boolean
  /** ログ用の表示名 */
  label: string
}) => {
  const { group, enabledKey, allowedGroupIdsKey, hasCredentials, label } = config

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
      logger.warn({ value }, `invalid ${allowedGroupIdsKey}, fallback to []`)
    }
    return []
  }

  /**
   * 連携設定を取得する。
   * 未設定・パース不可の場合は無効(enabled=false, allowedGroupIds=[])を返す。
   */
  const get = async (): Promise<IntegrationSettings> => {
    const store = await getByGroup(group)
    return {
      enabled: store[enabledKey] === 'true',
      allowedGroupIds: parseAllowedGroupIds(store[allowedGroupIdsKey]),
    }
  }

  /**
   * 連携設定を保存する。
   */
  const set = async ({ enabled, allowedGroupIds }: IntegrationSettings): Promise<void> => {
    await setStrings([
      { key: enabledKey, value: enabled ? 'true' : 'false', group },
      { key: allowedGroupIdsKey, value: JSON.stringify(allowedGroupIds), group },
    ])
    logger.info({ enabled, allowedGroupIds }, `${label} settings updated`)
  }

  /**
   * 渡したユーザーのうち連携を利用できるものだけに絞る(判定の単一ソース)。
   *
   * 1 ユーザーずつ判定すると対象の数だけ問い合わせが増えるため、こちらを本体にして
   * `canUse` はその薄いラッパにしてある。
   *
   * 1. 認証情報が未設定 → 利用不可(そもそも連携できない)
   * 2. グローバル無効 → 利用不可
   * 3. 許可グループ未指定 → 全ユーザー許可
   * 4. 許可グループ指定あり → ユーザーの所属グループと交差があれば許可
   */
  const filterAllowedUserIds = async (userIds: string[]): Promise<string[]> => {
    if (userIds.length === 0 || !hasCredentials()) {
      return []
    }

    const { enabled, allowedGroupIds } = await get()
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
   * 指定ユーザーが連携を利用できるかを判定する。
   */
  const canUse = async (userId: string): Promise<boolean> => {
    const allowed = await filterAllowedUserIds([userId])
    return allowed.length > 0
  }

  return { get, set, filterAllowedUserIds, canUse }
}
