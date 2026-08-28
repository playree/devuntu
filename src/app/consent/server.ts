'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { auth } from '@/lib/auth/auth'
import { errConsentInvalid, errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { scConsent } from '@/lib/schema/schema'
import { makeUrl } from '@/lib/server-utils'
import { isAPIError } from 'better-auth/api'
import { headers } from 'next/headers'

const CONSENT_ENDPOINT = '/api/auth/oauth2/consent'

/**
 * 同意画面の「許可」/「キャンセル」を oauth-provider へ渡し、遷移先URLを返す。
 *
 * `oauthQuery` は同意画面のURLに載っていた署名付きクエリ。HMAC と有効期限の検証は
 * プラグインの before フックが行うので、改ざん・期限切れはここではなくプラグイン側で弾かれる。
 *
 * 素の `headers` だけでは通らないので、呼び出しには下記を足している。
 * - headers の複製: Next の `headers()` は ReadonlyHeaders だが、プラグインが `ctx.headers.set('accept', ...)` する
 * - accept を JSON: これが無いとリダイレクトが戻り値ではなく 302 の例外として飛んでしまう
 * - request: 同意の保存後にプラグインが認可処理を内部で再実行し、その入口が `ctx.request` を必須にしている
 * - asResponse を false: request を渡すと既定が Response 返しに切り替わるため、戻り値で受け取るよう固定する
 */
export const submitConsent = safeAuthAction
  .metadata({ actionName: 'submitConsent', role: 'user' })
  .inputSchema(scConsent)
  .action(async ({ parsedInput: { accept, oauthQuery } }) => {
    const requestHeaders = new Headers(await headers())
    requestHeaders.set('accept', 'application/json')
    const body = { accept, oauth_query: oauthQuery }

    const res = await auth.api
      .oauth2Consent({
        headers: requestHeaders,
        body,
        request: new Request(makeUrl(CONSENT_ENDPOINT).toString(), {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(body),
        }),
        asResponse: false,
      })
      .catch((e: unknown) => {
        // 署名不正・期限切れは利用者にはやり直しを促すだけなので、画面用の errorType に寄せる
        if (isAPIError(e)) {
          logger.info({ error: e.body }, 'auth.api.oauth2Consent failed')
          throw errConsentInvalid()
        }
        throw e
      })
    logger.info({ accept }, 'auth.api.oauth2Consent')

    const url = res && typeof res === 'object' && 'url' in res ? res.url : undefined
    if (typeof url !== 'string' || !url) {
      throw errSystemError('consent redirect url is empty')
    }
    return { url }
  })
