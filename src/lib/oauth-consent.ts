import { type LocaleItem } from '@/locale'

/** 署名対象のパラメータ名を列挙するパラメータ(oauth-provider の signedQueryParameterNameParam) */
const SIGNED_PARAM_NAME_KEY = 'ba_param'

/**
 * 同意画面の URL クエリから `POST /oauth2/consent` へ渡す `oauth_query` を組み立てる。
 *
 * oauth-provider の署名検証(verifyOAuthQueryParams)は「渡されたクエリ全体(sig を除く)」で
 * HMAC を再計算するため、認可要求に含まれていなかったパラメータが1つでも混ざると検証に失敗する。
 * `ba_param` が署名対象の名前を列挙しているので、それと `sig` / `ba_param` 自身だけを残す。
 * 重複するパラメータ(`resource` など)と出現順は署名の対象なのでそのまま保つ。
 *
 * 公式のクライアントプラグイン(`oauthProviderClient`)が内部で行っている処理と同じ。
 * 当該関数はパッケージから公開されていないため自前で持つ。
 */
export const buildSignedOAuthQuery = (search: string): string | undefined => {
  const params = new URLSearchParams(search)
  if (!params.has('sig')) {
    return undefined
  }
  const signedNames = new Set(params.getAll(SIGNED_PARAM_NAME_KEY))
  if (signedNames.size === 0) {
    return undefined
  }

  const signed = new URLSearchParams()
  for (const [key, value] of params.entries()) {
    if (key === 'sig' || key === SIGNED_PARAM_NAME_KEY || signedNames.has(key)) {
      signed.append(key, value)
    }
  }
  return signed.toString()
}

const SCOPE_LOCALE_ITEMS: Record<string, LocaleItem> = {
  openid: 'scope_openid',
  profile: 'scope_profile',
  email: 'scope_email',
  offline_access: 'scope_offline_access',
  mcp: 'scope_mcp',
}

/** スコープの説明文用ロケールキー。説明を持たないスコープは undefined(スコープ名をそのまま表示する) */
export const consentScopeLocaleItem = (scope: string): LocaleItem | undefined => SCOPE_LOCALE_ITEMS[scope]

/** 認可要求の `scope` パラメータをスコープの配列に分解する。重複はクライアント次第で届くので除去する */
export const parseConsentScopes = (scope: string | undefined): string[] => [
  ...new Set(scope?.split(' ').filter(Boolean) ?? []),
]

/**
 * 認可要求の `claims` パラメータ(OIDC Core の claims request)から userinfo に要求されたクレーム名を取り出す。
 * クライアントが送る値なので、壊れていても画面を落とさず空配列にする。
 */
export const parseRequestedUserInfoClaims = (claims: string | undefined): string[] => {
  if (!claims) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(claims)
    if (typeof parsed !== 'object' || parsed === null) {
      return []
    }
    const userinfo = (parsed as { userinfo?: unknown }).userinfo
    if (typeof userinfo !== 'object' || userinfo === null) {
      return []
    }
    return Object.keys(userinfo)
  } catch {
    return []
  }
}
