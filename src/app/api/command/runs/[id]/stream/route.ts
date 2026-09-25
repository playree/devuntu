import { getServerSession } from '@/lib/auth/auth'
import { isAdminActor } from '@/lib/board/board-access'
import { parseCursor, sseHeaders } from '@/lib/command/command-api'
import { getCommandRun } from '@/lib/command/command-run'
import { buildLogStream } from '@/lib/command/command-stream'
import { consumeRateLimit } from '@/lib/rate-limit'

/**
 * 実行ログのライブ配信(SSE)。
 *
 * ここは薄く保ち、認可とヘッダだけを持つ。ストリームの組み立ては `command-stream.ts`。
 *
 * `src/proxy.ts` の matcher は `api/` を除外しているため、認証も認可もレート制限も自前で行う。
 * 実行しているプロセスは一切見ず DB だけを読むので、実行と配信が別プロセスでも成立する。
 */

/** 接続の張り直しを繰り返されても DB を叩き続けないための歯止め */
const SSE_RATE_LIMIT = { limit: 30, windowMs: 60_000 }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await getServerSession()
  if (!session?.user) {
    return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  if (!consumeRateLimit(`command-sse:${session.user.id}`, SSE_RATE_LIMIT)) {
    return new Response(null, { status: 429, headers: { 'Cache-Control': 'no-store' } })
  }

  const { id } = await params
  const run = await getCommandRun(id)
  // 存在を漏らさないため、権限が無い場合も「無い」と同じ 404 にする
  if (!run || (run.userId !== session.user.id && !isAdminActor(session.user))) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }

  /**
   * 再開位置。`EventSource` の自動再接続は `Last-Event-ID` を送るが、
   * リロード後は付かないので画面が持っている最終 seq を `?cursor=` で渡す。
   */
  const url = new URL(request.url)
  const fromSeq = parseCursor(request.headers.get('last-event-id') ?? url.searchParams.get('cursor'))

  return new Response(buildLogStream(id, fromSeq, request.signal), { headers: sseHeaders() })
}
