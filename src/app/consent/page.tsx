import { auth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { parseConsentScopes, parseRequestedUserInfoClaims } from '@/lib/oauth-consent'
import { isAPIError } from 'better-auth/api'
import { type Metadata } from 'next'
import { headers } from 'next/headers'
import { FC } from 'react'
import { ConsentClient } from './client'

export const metadata: Metadata = {
  title: 'Consent',
}

/**
 * OAuth Provider の同意画面。
 * oauth-provider が `consentPage` として認可要求の署名付きクエリを付けて遷移させてくる。
 * 未ログインの場合は proxy 側でサインイン画面へ送られるため、ここではセッションがある前提で描画する。
 */
const ConsentPage: FC<{
  searchParams: Promise<Record<string, string | string[] | undefined>>
}> = async ({ searchParams }) => {
  const params = await searchParams
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)
  const clientId = first(params.client_id)
  const signed = !!first(params.sig)

  const client = clientId
    ? await auth.api
        .getOAuthClientPublic({ headers: await headers(), query: { client_id: clientId } })
        .catch((e: unknown) => {
          // 無効な client_id は利用者にはやり直しを促すだけでよいので、画面は無効表示に寄せる
          if (isAPIError(e)) {
            logger.info({ clientId, error: e.body }, 'consent client not found')
            return undefined
          }
          throw e
        })
    : undefined

  return (
    <ConsentClient
      isValid={!!client && signed}
      clientName={client?.client_name}
      clientUri={client?.client_uri}
      logoUri={client?.logo_uri}
      tosUri={client?.tos_uri}
      policyUri={client?.policy_uri}
      scopes={parseConsentScopes(first(params.scope))}
      claims={parseRequestedUserInfoClaims(first(params.claims))}
    />
  )
}
export default ConsentPage
