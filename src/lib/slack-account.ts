/**
 * Slack 連携の可否設定・判定(サーバー専用)
 *
 * 実体は `integration-settings.ts` の共通実装。ここでは KVS のキーと認証情報の条件だけを与える。
 * prisma / kvs / env-util に依存するため、クライアントからは import しないこと。
 * (クライアント安全な定数・型は `slack.ts` を参照)
 */

import { envu } from './env-util'
import { createIntegrationSettings } from './integration-settings'

/** 連携に必要な環境変数が揃っているか。1 つでも欠けると連携も送信も成立しない */
export const hasSlackCredentials = () =>
  !!envu.server.SLACK_CLIENT_ID && !!envu.server.SLACK_CLIENT_SECRET && !!envu.server.SLACK_BOT_TOKEN

const slackAccount = createIntegrationSettings({
  group: 'SLACK',
  enabledKey: 'SLACK_ENABLED',
  allowedGroupIdsKey: 'SLACK_ALLOWED_GROUP_IDS',
  hasCredentials: hasSlackCredentials,
  label: 'slack',
})

export const getSlackSettings = slackAccount.get
export const setSlackSettings = slackAccount.set
/** 通知の宛先候補を、Slack 連携を利用できるユーザーだけに絞る */
export const filterSlackAllowedUserIds = slackAccount.filterAllowedUserIds
export const canUseSlackAccount = slackAccount.canUse
