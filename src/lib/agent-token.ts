/**
 * AIエージェント用の長期トークン(サーバー専用)
 *
 * エージェントは Web ログインできないため認可コードフローを踏めない。代わりに管理画面で発行した
 * このトークンを `Authorization: Bearer` に載せて `/api/mcp` を利用する。
 *
 * 平文は発行時の応答にしか現れず、DB にはハッシュだけを保存する。停止は失効(`revokedAt`)か
 * 有効期限(`expiresAt`)、またはエージェントユーザー自体の BAN / 削除で行う。
 */

import { nanoid } from 'nanoid'
import { createHash } from 'node:crypto'
import { MCP_SCOPE } from './auth'
import { nowDate, withinMinutes } from './day'
import { logger } from './logger'
import type { ResourceAuthResult } from './oauth/oauth-resource'
import { prisma } from './prisma'

/** OAuth のアクセストークン(JWT)と取り違えないための接頭辞 */
export const AGENT_TOKEN_PREFIX = 'devuntu_agent_'

/** 一覧に出す末尾の文字数。先頭は全トークン共通の接頭辞なので末尾側を見せる */
const HINT_LENGTH = 6

/** `lastUsedAt` を書き直す間隔。リクエストごとの UPDATE を避けるためのしきい値 */
const LAST_USED_REFRESH_MINUTES = 5

/** 受け取ったトークンがエージェント用かを接頭辞で判定する */
export const isAgentToken = (token: string): boolean => token.startsWith(AGENT_TOKEN_PREFIX)

/** 新しいトークンを作る。戻り値の平文はこの1回しか取得できない */
export const generateAgentToken = (): { token: string; hint: string } => {
  const token = `${AGENT_TOKEN_PREFIX}${nanoid(48)}`
  return { token, hint: token.slice(-HINT_LENGTH) }
}

/** 保存 / 照合に使うハッシュ。トークンは十分な長さの乱数なのでソルトもストレッチも要らない */
export const hashAgentToken = (token: string): string => createHash('sha256').update(token).digest('hex')

/**
 * エージェントトークンを検証し、対応するエージェントユーザーを返す。
 *
 * OAuth 側(`verifyMcpAccessToken`)と同じ形を返すので、`/api/mcp` から先の処理は共通にできる。
 */
export const verifyAgentToken = async (token: string): Promise<ResourceAuthResult> => {
  const row = await prisma.agentToken.findUnique({
    where: { tokenHash: hashAgentToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      user: { select: { id: true, name: true, email: true, role: true, banned: true, isAgent: true } },
    },
  })
  if (!row) {
    return { ok: false, error: 'invalid_token' }
  }

  const now = nowDate()
  if (row.revokedAt || (row.expiresAt && row.expiresAt <= now)) {
    logger.info({ agentTokenId: row.id }, 'agent token revoked or expired')
    return { ok: false, error: 'invalid_token' }
  }

  const { user } = row
  if (!user.isAgent || user.banned) {
    logger.info({ agentTokenId: row.id, userId: user.id }, 'agent token user unavailable')
    return { ok: false, error: 'invalid_token' }
  }

  if (!row.lastUsedAt || !withinMinutes(row.lastUsedAt, LAST_USED_REFRESH_MINUTES)) {
    await prisma.agentToken.update({ where: { id: row.id }, data: { lastUsedAt: now } })
  }

  return {
    ok: true,
    auth: {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      scopes: [MCP_SCOPE],
      kind: 'agent',
      clientId: row.id,
    },
  }
}
