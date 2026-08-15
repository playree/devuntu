/**
 * Google アカウント連携の可否設定・判定(サーバー専用)
 *
 * 実体は `integration-settings.ts` の共通実装。ここでは KVS のキーと認証情報の条件だけを与える。
 * prisma / kvs / env-util に依存するため、クライアントからは import しないこと。
 * (クライアント安全な定数・型は `google-calendar.ts` を参照)
 */

import { envu } from './env-util'
import { createIntegrationSettings } from './integration-settings'

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
export const canUseGoogleAccount = googleAccount.canUse
