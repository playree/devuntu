/**
 * 認証・アカウント(サインイン / OIDC クライアント / 同意 / パスキー / MCP トークン / アバター)の入力スキーマ
 */

import { z } from 'zod'
import { TOKEN_EXPIRES } from '../token-expires'
import { zEmail, zImageFile, zName, zPassword } from './schema'

export const scSignInUsername = z.object({
  username: zEmail,
})
export type SignInUsername = z.infer<typeof scSignInUsername>

export const scSignInPassword = z.object({
  password: z.string(),
})
export type SignInPassword = z.infer<typeof scSignInPassword>

export const scOtp = z.object({
  otp: z.string(),
})
export type Otp = z.infer<typeof scOtp>

export const scTwoFaCode = z.object({
  otp: z.string(),
  trustDevice: z.boolean(),
})
export type TwoFaCode = z.infer<typeof scTwoFaCode>

export const scCreateAdmin = z.object({
  name: zName,
  email: zEmail,
  password: zPassword.optional(),
})
export type CreateAdmin = z.infer<typeof scCreateAdmin>

export const scAddOidcClient = z.object({
  clientName: z.string(),
  redirectUri: z.url(),
  skipConsent: z.boolean(),
  requirePkce: z.boolean(),
  tokenEndpointAuthMethod: z.enum(['client_secret_basic', 'client_secret_post']),
})
export type AddOidcClient = z.infer<typeof scAddOidcClient>

export const scUpdateOidcClient = z.object({
  clientId: z.string(),
  clientName: z.string(),
  redirectUri: z.url(),
  skipConsent: z.boolean(),
})
export type UpdateOidcClient = z.infer<typeof scUpdateOidcClient>

export const scSetOidcClientDisabled = z.object({
  clientId: z.string(),
  disabled: z.boolean(),
})

export const scDeleteOidcClient = z.object({
  clientId: z.string(),
})

export const scConsent = z.object({
  accept: z.boolean(),
  oauthQuery: z.string().min(1),
})
export type Consent = z.infer<typeof scConsent>

/** ユーザー用 MCP トークンの発行。名前は持ち主の中で一意 */
export const scIssueMcpToken = z.object({
  name: zName,
  expires: z.enum(TOKEN_EXPIRES),
})
export type IssueMcpToken = z.infer<typeof scIssueMcpToken>

export const scUpdatePasskey = z.object({
  id: z.uuidv7(),
  name: z.string(),
})
export type UpdatePasskey = z.infer<typeof scUpdatePasskey>

export const scSetUserAvatar = z.object({
  image: zImageFile.nullable(), // File = 新規アップロード / null = 削除してOIDC同期を再開
})
export type SetUserAvatar = z.infer<typeof scSetUserAvatar>

export const scSetUserTimezone = z.object({ timezone: z.string() })

export const scSetUserLocale = z.object({ locale: z.string() })
