'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import {
  disconnectAccount,
  getGoogleAccountStatus as getGoogleStatus,
  getSlackAccountStatus,
} from '@/lib/auth/account-link'
import { assertFreshSession } from '@/lib/auth/session-fresh'
import { updateUserAvatar, updateUserTimezone } from '@/lib/auth/user-profile'
import { envu } from '@/lib/env-util'
import { errValidation } from '@/lib/error'
import { deleteUserMcpToken, issueUserMcpToken, listUserMcpTokens } from '@/lib/mcp/mcp-token'
import { getUserNotifySettings, setUserNotifySettings } from '@/lib/notify/notify-setting'
import { listUserOAuthConsents, revokeUserOAuthConsent } from '@/lib/oauth/oauth-consent-store'
import { assertRateLimit } from '@/lib/rate-limit'
import { scUUID } from '@/lib/schema/schema'
import { scIssueMcpToken, scSetUserAvatar } from '@/lib/schema/schema-auth'
import { scUpdateNotifySettings, scWebPushSubscription } from '@/lib/schema/schema-notify'
import {
  isWebPushConfigured,
  listWebPushDevices,
  removeWebPushDevice,
  saveWebPushSubscription,
} from '@/lib/webpush/webpush-server'
import { z } from 'zod'

/**
 * アカウント画面の Server Action。
 * 処理本体は `@/lib/auth/account-link` / `user-profile`、`@/lib/mcp/mcp-token`、
 * `@/lib/oauth/oauth-consent-store`、`@/lib/webpush/webpush-server` にある。
 */

/** MCP トークン発行の連打防止。誤操作で使い捨てのトークンを量産させない */
const MCP_TOKEN_ISSUE_RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 }

export const getGoogleAccountStatus = safeAuthAction
  .metadata({ actionName: 'getGoogleAccountStatus', role: 'user' })
  .action(async ({ ctx: { user } }) => await getGoogleStatus(user.id))
export type GetGoogleAccountStatusReturnType = Awaited<ReturnType<typeof getGoogleAccountStatus>>['data']

export const disconnectGoogleAccount = safeAuthAction
  .metadata({ actionName: 'disconnectGoogleAccount', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await disconnectAccount(user.id, 'google')
    return { disconnected: true }
  })

export const getSlackStatus = safeAuthAction
  .metadata({ actionName: 'getSlackStatus', role: 'user' })
  .action(async ({ ctx: { user } }) => await getSlackAccountStatus(user.id))
export type GetSlackStatusReturnType = Awaited<ReturnType<typeof getSlackStatus>>['data']

export const disconnectSlack = safeAuthAction
  .metadata({ actionName: 'disconnectSlack', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await disconnectAccount(user.id, 'slack')
    return { disconnected: true }
  })

export const getMyOAuthConsents = safeAuthAction
  .metadata({ actionName: 'getMyOAuthConsents', role: 'user' })
  .action(async ({ ctx: { user } }) => await listUserOAuthConsents(user.id))
export type GetMyOAuthConsentsReturnType = Awaited<ReturnType<typeof getMyOAuthConsents>>['data']

/** 許可済みアプリの取り消し。対象クライアント宛の発行済みトークンも失効させる */
export const revokeOAuthConsent = safeAuthAction
  .metadata({ actionName: 'revokeOAuthConsent', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id }, ctx: { user } }) => {
    await revokeUserOAuthConsent(user.id, id)
    return { id }
  })

/* -------------------------------------------------------------------------------------------------
 * ユーザー用 MCP トークン
 *
 * ブラウザを開けない環境から MCP を使うための長期トークン。発行できるのは本人だけで、
 * 平文は発行の応答にしか現れない。検証は `src/lib/mcp/mcp-token.ts`。
 * ---------------------------------------------------------------------------------------------- */

/** 一覧取得。平文は保持していないので、見分け用の末尾数文字だけを返す */
export const getMyMcpTokens = safeAuthAction
  .metadata({ actionName: 'getMyMcpTokens', role: 'user' })
  .action(async ({ ctx: { user } }) => await listUserMcpTokens(user.id))
export type GetMyMcpTokensReturnType = Awaited<ReturnType<typeof getMyMcpTokens>>['data']

/**
 * トークン発行。
 *
 * 発行するのはセッションより長生きする資格情報なので、パスキー登録と同じくセッションの鮮度を要求する。
 * セッション Cookie だけを奪われた場合に、セッション失効後も使えるトークンを残させないため。
 */
export const issueMcpToken = safeAuthAction
  .metadata({ actionName: 'issueMcpToken', role: 'user' })
  .inputSchema(scIssueMcpToken)
  .action(async ({ parsedInput, ctx: { user, session } }) => {
    // 再認証してやり直す正常なフローで発行回数の枠を使わせないよう、レート制限より前に判定する
    assertFreshSession(session)
    assertRateLimit(`mcp-token-issue:${user.id}`, MCP_TOKEN_ISSUE_RATE_LIMIT)

    return { token: await issueUserMcpToken(user.id, parsedInput) }
  })

/** トークン削除。行を消すので、このトークンを使っている接続はその場で切れる */
export const deleteMcpToken = safeAuthAction
  .metadata({ actionName: 'deleteMcpToken', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id }, ctx: { user } }) => {
    await deleteUserMcpToken(user.id, id)
    return { id }
  })

export const getNotifySettings = safeAuthAction
  .metadata({ actionName: 'getNotifySettings', role: 'user' })
  .action(async ({ ctx: { user } }) => getUserNotifySettings(user.id))

export const updateNotifySettings = safeAuthAction
  .metadata({ actionName: 'updateNotifySettings', role: 'user' })
  .inputSchema(scUpdateNotifySettings)
  .action(async ({ parsedInput: { settings }, ctx: { user } }) => {
    await setUserNotifySettings(user.id, settings)
    return { settings }
  })

/**
 * Web プッシュの購読に使う VAPID 公開鍵。
 *
 * `NEXT_PUBLIC_*` にできない(事前ビルド済みのイメージではビルド時にインライン化された値が
 * 空になる)ため、実行時に Server Action で返す。未構成なら null で、画面は購読 UI を出さない。
 */
export const getWebPushPublicKey = safeAuthAction
  .metadata({ actionName: 'getWebPushPublicKey', role: 'user' })
  .action(async () => (isWebPushConfigured() ? (envu.server.VAPID_PUBLIC_KEY as string) : null))

/** この利用者が登録している端末の一覧(解除の対象) */
export const getWebPushDevices = safeAuthAction
  .metadata({ actionName: 'getWebPushDevices', role: 'user' })
  .action(async ({ ctx: { user } }) => await listWebPushDevices(user.id))
export type GetWebPushDevicesReturnType = Awaited<ReturnType<typeof getWebPushDevices>>['data']

/** 端末の購読を登録する。同じ端末から登録し直しても行は増えない(エンドポイントで一意) */
export const registerWebPushDevice = safeAuthAction
  .metadata({ actionName: 'registerWebPushDevice', role: 'user' })
  .inputSchema(scWebPushSubscription)
  .action(async ({ parsedInput, ctx: { user } }) => {
    if (!isWebPushConfigured()) {
      throw errValidation('web push is not configured')
    }
    await saveWebPushSubscription(user.id, parsedInput)
    return { endpoint: parsedInput.endpoint }
  })

/** 端末の購読を解除する。他人の端末は消せない */
export const deleteWebPushDevice = safeAuthAction
  .metadata({ actionName: 'deleteWebPushDevice', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id }, ctx: { user } }) => {
    await removeWebPushDevice(user.id, id)
    return { id }
  })

export const setUserTimezone = safeAuthAction
  .metadata({ actionName: 'setUserTimezone', role: 'user' })
  .inputSchema(z.object({ timezone: z.string() }))
  .action(async ({ parsedInput: { timezone }, ctx: { user } }) => {
    await updateUserTimezone(user.id, timezone)
    return { timezone }
  })

/** アバター更新。null 指定で削除すると、次回のOIDCログインでIdP側のアバターが改めてコピーされる */
export const setUserAvatar = safeAuthAction
  .metadata({ actionName: 'setUserAvatar', role: 'user' })
  .inputSchema(scSetUserAvatar)
  .action(async ({ parsedInput: { image }, ctx: { user } }) => ({ image: await updateUserAvatar(user.id, image) }))
