/**
 * AIエージェント用の長期トークン(サーバー専用)
 *
 * エージェントは Web ログインできないため認可コードフローを踏めない。代わりに管理画面で発行した
 * このトークンを `Authorization: Bearer` に載せて `/api/mcp` を利用する。
 *
 * 1エージェントにつき1本だけ持ち、再発行は既存の行を置き換えるローテートになる。平文は発行時の
 * 応答にしか現れず、DB にはハッシュだけを保存する。停止は有効期限(`expiresAt`)、再発行による
 * 置き換え、またはエージェントユーザー自体の BAN / 削除で行う。
 *
 * 生成とハッシュの形式は通常ユーザー向けの MCP トークン(`../mcp/mcp-token.ts`)と共通で、
 * 接頭辞だけが違う。共通部分は `../bearer-token.ts` にある。
 */

import { MCP_SCOPE } from '../auth/auth'
import { generateBearerToken, hashBearerToken, shouldRefreshLastUsed } from '../bearer-token'
import { nowDate } from '../day'
import { logger } from '../logger'
import type { ResourceAuthResult } from '../oauth/oauth-resource'
import { prisma } from '../prisma'
import { AGENT_TOKEN_PREFIX } from './agent'

export const isAgentToken = (token: string): boolean => token.startsWith(AGENT_TOKEN_PREFIX)

/** 戻り値の平文はこの1回しか取得できない */
export const generateAgentToken = (): { token: string; hint: string } => generateBearerToken(AGENT_TOKEN_PREFIX)

/** 保存 / 照合に使うハッシュ */
export const hashAgentToken = (token: string): string => hashBearerToken(token)

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
      lastUsedAt: true,
      user: { select: { id: true, name: true, email: true, role: true, banned: true, isAgent: true } },
    },
  })
  if (!row) {
    return { ok: false, error: 'invalid_token' }
  }

  const now = nowDate()
  if (row.expiresAt && row.expiresAt <= now) {
    logger.info({ agentTokenId: row.id }, 'agent token expired')
    return { ok: false, error: 'invalid_token' }
  }

  const { user } = row
  if (!user.isAgent || user.banned) {
    logger.info({ agentTokenId: row.id, userId: user.id }, 'agent token user unavailable')
    return { ok: false, error: 'invalid_token' }
  }

  // 利用記録の失敗で認証まで落とさない
  if (shouldRefreshLastUsed(row.lastUsedAt)) {
    await prisma.agentToken
      .update({ where: { id: row.id }, data: { lastUsedAt: now } })
      .catch((error: unknown) => logger.warn({ error, agentTokenId: row.id }, 'agent token lastUsedAt update failed'))
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
