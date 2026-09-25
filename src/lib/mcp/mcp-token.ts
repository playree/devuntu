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
import { nowDate } from '../day'
import { errClient, errNotFound } from '../error'
import { logger } from '../logger'
import type { ResourceAuthResult } from '../oauth/oauth-resource'
import { isUniqueViolation, prisma } from '../prisma'
import { tokenExpiresAt, type TokenExpires } from '../token-expires'
import { DUPLICATED_MCP_TOKEN_NAME, MAX_MCP_TOKENS_PER_USER, MCP_TOKEN_LIMIT_REACHED, MCP_TOKEN_PREFIX } from './mcp'

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

/** 本人のトークン一覧。平文は保持していないので、見分け用の末尾数文字だけを返す */
export const listUserMcpTokens = async (userId: string) =>
  prisma.mcpToken.findMany({
    where: { userId },
    select: { id: true, name: true, hint: true, expiresAt: true, lastUsedAt: true, createdAt: true },
  })

/**
 * トークン発行。平文を返せるのはこの応答だけで、DB にはハッシュしか残らない。
 *
 * 本数の上限は UI のボタン無効化と合わせた二重の歯止め。件数の確認から作成までの間に
 * 別のタブから発行されると上限を超えうるが、実害が無いので楽観で許容する。
 */
export const issueUserMcpToken = async (
  userId: string,
  { name, expires }: { name: string; expires: TokenExpires },
): Promise<string> => {
  if ((await prisma.mcpToken.count({ where: { userId } })) >= MAX_MCP_TOKENS_PER_USER) {
    throw errClient(MCP_TOKEN_LIMIT_REACHED)
  }

  const { token, hint } = generateMcpToken()
  const issued = await prisma.mcpToken
    .create({
      data: { userId, name, tokenHash: hashMcpToken(token), hint, expiresAt: tokenExpiresAt(expires, nowDate()) },
      select: { id: true },
    })
    .catch((e: unknown) => {
      if (isUniqueViolation(e)) {
        throw errClient(DUPLICATED_MCP_TOKEN_NAME)
      }
      throw e
    })

  logger.info({ mcpTokenId: issued.id, userId }, 'mcp token issued')
  return token
}

/** トークン削除。行を消すので、このトークンを使っている接続はその場で切れる */
export const deleteUserMcpToken = async (userId: string, id: string): Promise<void> => {
  const token = await prisma.mcpToken.findUnique({ where: { id }, select: { userId: true } })
  // 他人の行は存在自体を伏せる
  if (!token || token.userId !== userId) {
    throw errNotFound()
  }

  await prisma.mcpToken.delete({ where: { id } })

  logger.info({ mcpTokenId: id, userId }, 'mcp token deleted')
}
