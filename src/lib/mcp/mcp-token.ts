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

import { BEARER_TOKEN_ROW_SELECT, generateBearerToken, hashBearerToken, verifyBearerTokenRow } from '../bearer-token'
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
 * 人間の経路なので、エージェントユーザーの行があっても使わせない(`verifyAgentToken` と逆向き)。
 */
export const verifyMcpToken = async (token: string): Promise<ResourceAuthResult> =>
  verifyBearerTokenRow(
    await prisma.mcpToken.findUnique({ where: { tokenHash: hashMcpToken(token) }, select: BEARER_TOKEN_ROW_SELECT }),
    {
      kind: 'pat',
      agentUser: false,
      log: { idKey: 'mcpTokenId', label: 'mcp token' },
      touch: (id, now) => prisma.mcpToken.update({ where: { id }, data: { lastUsedAt: now } }),
    },
  )
