/**
 * OAuth の認可要求に課すセッションの鮮度。
 *
 * `offline_access` のリフレッシュトークンは Web セッションより長生きするので、MCP トークンの手動発行
 * (`assertFreshSession`)と同じく、ログインからの経過が `SESSION_FRESH_AGE` 未満であることを要求する。
 * 判定は oauth-provider が実装している OIDC の `max_age` に任せ、認可要求へ差し込むだけにする。
 * 古いセッションはサインイン画面へ送られ、再ログイン後に認可がそのまま続く。
 *
 * 判定は引数だけで決まる純粋関数にして `tests/lib/oauth/oauth-authorize.test.ts` の対象にする
 * (env / prisma / logger には依存させない)。
 */

const OFFLINE_ACCESS_SCOPE = 'offline_access'

/**
 * セッションの鮮度を要求する認可要求か。
 * `scope` が無い要求はクライアントの既定スコープになり、DCR の既定は `offline_access` を含むので対象に倒す。
 */
export const requiresFreshAuthorization = (scope: unknown): boolean =>
  typeof scope !== 'string' || scope.split(' ').includes(OFFLINE_ACCESS_SCOPE)

/**
 * 認可要求に設定する `max_age`(秒)。`freshAge` が `0` ならチェック無効として undefined を返す。
 * クライアントが既により厳しい `max_age` を求めていればそれを尊重し、緩い・読めない値は `freshAge` で上書きする。
 */
export const freshMaxAge = (requested: unknown, freshAge: number): number | undefined => {
  if (freshAge === 0) {
    return undefined
  }
  const maxAge = typeof requested === 'string' && requested.trim() !== '' ? Number(requested) : requested
  if (typeof maxAge === 'number' && Number.isInteger(maxAge) && maxAge >= 0 && maxAge <= freshAge) {
    return maxAge
  }
  return freshAge
}
