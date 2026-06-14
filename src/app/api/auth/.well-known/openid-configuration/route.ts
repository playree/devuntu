import { auth } from '@/lib/auth'
import { oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider'

// export const GET = oauthProviderOpenIdConfigMetadata(auth)

const handler = oauthProviderOpenIdConfigMetadata(auth)

export const GET = async (req: Request) => {
  const res = await handler(req)

  // ヘルパーのレスポンスから end_session_endpoint を除去
  const metadata = await res.json()
  delete metadata.end_session_endpoint

  return new Response(JSON.stringify(metadata), {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      // 元のキャッシュ制御を引き継ぐ
      ...(res.headers.get('Cache-Control') ? { 'Cache-Control': res.headers.get('Cache-Control')! } : {}),
    },
  })
}
