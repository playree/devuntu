/**
 * ランナー(Devuntu Agent)向け軽量API の共通処理(サーバー専用)
 *
 * `/api/mcp` と違い、5分おきのポーリングで叩かれるだけの経路なので MCP プロトコルには乗せない。
 * 認証はエージェント用の長期トークンだけを受け付ける(人間の OAuth トークンでは使えない)。
 * Proxy の対象外なので、認証・レート制限はこのファイルを通して各ルートハンドラで行う。
 */

import { findAgentRunner, type AgentRunnerRow } from './agent-runner'
import { isAgentToken, verifyAgentToken } from './agent-token'
import { logger } from './logger'
import type { ResourceAuth } from './oauth/oauth-resource'
import { parseBearerToken } from './oauth/oauth-resource'
import { consumeRateLimit, type RateLimitRule } from './rate-limit'

/**
 * ポーリング間隔は既定5分なので、通常は1分に1回も来ない。
 * 設定ミスで詰まったランナーが叩き続けるのを止められればよいので緩めに取る。
 */
const RUNNER_RATE_LIMIT: RateLimitRule = { limit: 30, windowMs: 60 * 1000 }

/** ランナー向けの応答。中間キャッシュに残さない */
export const agentJson = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export const agentError = (status: number, error: string): Response => agentJson({ error }, status)

export type RunnerContext = {
  auth: ResourceAuth
  /** 自動運用の設定。未設定(自動運用を使わない)の場合は null */
  runner: AgentRunnerRow | null
}

export type RunnerAuthResult = { ok: true; ctx: RunnerContext } | { ok: false; response: Response }

/**
 * ランナーの認証。
 *
 * `devuntu_agent_` 接頭辞を持たない Bearer は、たとえ有効な OAuth アクセストークンでも拒否する。
 * この経路はエージェント本人の巡回専用で、人間の MCP クライアントが使う口ではない。
 */
export const authenticateRunner = async (request: Request): Promise<RunnerAuthResult> => {
  const token = parseBearerToken(request.headers.get('authorization'))
  if (!token || !isAgentToken(token)) {
    return { ok: false, response: agentError(401, 'invalid_token') }
  }

  const result = await verifyAgentToken(token)
  if (!result.ok) {
    return { ok: false, response: agentError(401, result.error) }
  }

  if (!consumeRateLimit(`agent-api:${result.auth.user.id}`, RUNNER_RATE_LIMIT)) {
    logger.warn({ userId: result.auth.user.id }, 'agent api rate limited')
    return { ok: false, response: agentError(429, 'too_many_requests') }
  }

  return { ok: true, ctx: { auth: result.auth, runner: await findAgentRunner(result.auth.user.id) } }
}

/** JSON ボディの読み取り。本文なし・壊れた JSON は空オブジェクトとして扱う */
export const readJsonBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return {}
  }
}
