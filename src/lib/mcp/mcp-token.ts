/**
 * 通常ユーザー用の MCP トークン(サーバー専用)
 *
 * ブラウザを開けない環境(CI、サーバー、ヘッドレス端末)からは認可コードフローを踏めないため、
 * アカウントページで本人が発行したこのトークンを `Authorization: Bearer` に載せて `/api/mcp`
 * を利用する。権限は発行した本人の画面上の権限とちょうど同じで、スコープは MCP に固定する。
 *
 * 1ユーザーが複数本を持てる。平文は発行時の応答にしか現れず、DB にはハッシュだけを保存する。
 * 停止は有効期限(`expiresAt`)、一覧からの削除、またはユーザーの BAN / 削除で行う。
 *
 * 生成とハッシュの形式はエージェント用トークン(`../agent/agent-token.ts`)と共通で、
 * 接頭辞だけが違う。共通部分は `../bearer-token.ts` にある。
 */

import { MCP_SCOPE } from '../auth/auth'
import { generateBearerToken, hashBearerToken, shouldRefreshLastUsed } from '../bearer-token'
import { nowDate } from '../day'
import { logger } from '../logger'
import type { ResourceAuthResult } from '../oauth/oauth-resource'
import { prisma } from '../prisma'
import { MCP_TOKEN_PREFIX } from './mcp'

export const isMcpToken = (token: string): boolean => token.startsWith(MCP_TOKEN_PREFIX)

/** 戻り値の平文はこの1回しか取得できない */
export const generateMcpToken = (): { token: string; hint: string } => generateBearerToken(MCP_TOKEN_PREFIX)

/** 保存 / 照合に使うハッシュ */
export const hashMcpToken = (token: string): string => hashBearerToken(token)

/**
 * ユーザー用 MCP トークンを検証し、対応するユーザーを返す。
 *
 * OAuth 側(`verifyMcpAccessToken`)と同じ形を返すので、`/api/mcp` から先の処理は共通にできる。
 */
export const verifyMcpToken = async (token: string): Promise<ResourceAuthResult> => {
  const row = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashMcpToken(token) },
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
    logger.info({ mcpTokenId: row.id }, 'mcp token expired')
    return { ok: false, error: 'invalid_token' }
  }

  const { user } = row
  /**
   * エージェント判定が `verifyAgentToken` と逆向きになっている。
   * こちらは人間の経路なので、エージェントユーザーの行があっても使わせない。
   */
  if (user.isAgent || user.banned) {
    logger.info({ mcpTokenId: row.id, userId: user.id }, 'mcp token user unavailable')
    return { ok: false, error: 'invalid_token' }
  }

  // 利用記録の失敗で認証まで落とさない
  if (shouldRefreshLastUsed(row.lastUsedAt)) {
    await prisma.mcpToken
      .update({ where: { id: row.id }, data: { lastUsedAt: now } })
      .catch((error: unknown) => logger.warn({ error, mcpTokenId: row.id }, 'mcp token lastUsedAt update failed'))
  }

  return {
    ok: true,
    auth: {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      scopes: [MCP_SCOPE],
      kind: 'pat',
      clientId: row.id,
    },
  }
}
