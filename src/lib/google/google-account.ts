/**
 * Google アカウント連携の可否設定・判定(サーバー専用)
 *
 * 実体は `integration-settings.ts` の共通実装。ここでは KVS のキーと認証情報の条件だけを与える。
 * prisma / kvs / env-util に依存するため、クライアントからは import しないこと。
 * (クライアント安全な定数・型は `google-calendar.ts` を参照)
 */

import type { AccountOrderByWithRelationInput, AccountWhereInput } from '@/generated/prisma/models'
import { cache } from 'react'
import { envu } from '../env-util'
import { createIntegrationSettings } from '../integration-settings'
import { GOOGLE_ACCOUNT_PROVIDER_ID } from './google-calendar'

/**
 * カレンダー連携用の account 行を引く条件。
 * account には `(userId, providerId)` の一意制約が無く、連携をやり直すと同じ組み合わせの
 * 行が複数残り得るので、refresh token を持つ最新の行に絞って結果を一意にする。
 */
export const googleAccountQuery = (userId: string) => ({
  where: {
    userId,
    providerId: GOOGLE_ACCOUNT_PROVIDER_ID,
    refreshToken: { not: null },
  } satisfies AccountWhereInput,
  orderBy: { updatedAt: 'desc' } satisfies AccountOrderByWithRelationInput,
})

/** 連携に必要な環境変数が揃っているか。1 つでも欠けるとそもそも連携できない */
const hasGoogleCredentials = () => !!envu.server.GOOGLE_CLIENT_ID && !!envu.server.GOOGLE_CLIENT_SECRET

const googleAccount = createIntegrationSettings({
  group: 'GOOGLE_ACCOUNT',
  enabledKey: 'GOOGLE_ACCOUNT_ENABLED',
  allowedGroupIdsKey: 'GOOGLE_ACCOUNT_ALLOWED_GROUP_IDS',
  hasCredentials: hasGoogleCredentials,
  label: 'google account',
})

export const getGoogleAccountSettings = googleAccount.get
export const setGoogleAccountSettings = googleAccount.set
/** レイアウトとページが同じリクエストで判定するので、リクエスト内では 1 回だけ問い合わせる */
export const canUseGoogleAccount = cache(googleAccount.canUse)
