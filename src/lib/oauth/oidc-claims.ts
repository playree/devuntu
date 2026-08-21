/**
 * 自身が OIDC プロバイダとして発行する ID token 用の標準クレーム(OIDC Core §5.1)。
 *
 * `@better-auth/oauth-provider` 1.7 から標準クレームは userinfo エンドポイント専用になり、
 * ID token からは必ず除かれるようになった。ID token のクレームしか読まないクライアント
 * (NetBird の埋め込み Dex コネクタなど)は `name` / `email` が取れずに認証を失敗させるため、
 * `customIdTokenClaims` でこれを補う。
 */

/** クレームの解決に必要なユーザー情報。テストから better-auth の初期化を巻き込まないため型を最小限にしている */
type ClaimUser = {
  name: string
  email: string
  emailVerified: boolean
  image?: string | null
}

/** 表示名を `given_name` / `family_name` に分解する。空白で区切れない表示名では付けない */
const splitDisplayName = (name: string) => {
  const parts = name.split(' ').filter((part) => part !== '')
  if (parts.length <= 1) {
    return {}
  }
  return { given_name: parts.slice(0, -1).join(' '), family_name: parts.at(-1) }
}

/** 付与された scope に対応する標準クレームを返す。値を持たないクレームはキー自体を含めない */
export const idTokenStandardClaims = (user: ClaimUser, scopes: string[]) => ({
  ...(scopes.includes('profile') && {
    name: user.name,
    ...(user.image && { picture: user.image }),
    ...splitDisplayName(user.name),
  }),
  ...(scopes.includes('email') && { email: user.email, email_verified: user.emailVerified }),
})
