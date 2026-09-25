/**
 * Bearer 認証で使う長期トークンの共通処理(サーバー専用)
 *
 * エージェント用(`agent/agent-token.ts`)とユーザー用(`mcp/mcp-token.ts`)で
 * 生成・保存の形式を揃えるために切り出してある。どちらの検証も
 * `Authorization: Bearer` に載った平文をハッシュ化して DB の1行と突き合わせる。
 *
 * 引くテーブルと、持ち主に求めるユーザーの種別(エージェントか人間か)だけが経路ごとに違う。
 */

import { nanoid } from 'nanoid'
import { createHash } from 'node:crypto'
import { MCP_SCOPE } from './auth/mcp-scope'
import { nowDate, withinMinutes } from './day'
import { logger } from './logger'
import type { ResourceAuthResult } from './oauth/oauth-resource'

/** 一覧に出す末尾の文字数。先頭は接頭辞で共通なので末尾側を見せる */
const HINT_LENGTH = 6

/** `lastUsedAt` を書き直す間隔。リクエストごとの UPDATE を避けるためのしきい値 */
const LAST_USED_REFRESH_MINUTES = 5

/** 平文の乱数部の長さ。接頭辞と合わせて1つのトークンになる */
const RANDOM_LENGTH = 48

/** 戻り値の平文はこの1回しか取得できない */
export const generateBearerToken = (prefix: string): { token: string; hint: string } => {
  const token = `${prefix}${nanoid(RANDOM_LENGTH)}`
  return { token, hint: token.slice(-HINT_LENGTH) }
}

/** 保存 / 照合に使うハッシュ。トークンは十分な長さの乱数なのでソルトもストレッチも要らない */
export const hashBearerToken = (token: string): string => createHash('sha256').update(token).digest('hex')

/** 最終利用時刻を書き直すかどうか。未記録か、しきい値より古い場合だけ書く */
export const shouldRefreshLastUsed = (lastUsedAt: Date | null): boolean =>
  !lastUsedAt || !withinMinutes(lastUsedAt, LAST_USED_REFRESH_MINUTES)

/** 検証で引くトークン行の列。エージェント用 / ユーザー用で同じ形にする */
export const BEARER_TOKEN_ROW_SELECT = {
  id: true,
  expiresAt: true,
  lastUsedAt: true,
  user: { select: { id: true, name: true, email: true, role: true, banned: true, isAgent: true } },
} as const

type BearerTokenRow = {
  id: string
  expiresAt: Date | null
  lastUsedAt: Date | null
  user: { id: string; name: string; email: string; role: string | null; banned: boolean | null; isAgent: boolean }
}

/**
 * ハッシュで引いたトークンの行を検証し、OAuth 側(`verifyMcpAccessToken`)と同じ形の結果にする。
 *
 * 有効期限と持ち主の状態(BAN / 種別)を確かめ、最終利用時刻を必要なときだけ書き直す。
 * 利用記録の失敗で認証まで落とさない。
 */
export const verifyBearerTokenRow = async (
  row: BearerTokenRow | null,
  opts: {
    kind: 'agent' | 'pat'
    /** 持ち主に求める種別。経路と違う種別のユーザーの行があっても使わせない */
    agentUser: boolean
    /** ログの項目名(`agentTokenId` など)と文言の接頭辞(`agent token` など) */
    log: { idKey: string; label: string }
    touch: (id: string, now: Date) => Promise<unknown>
  },
): Promise<ResourceAuthResult> => {
  if (!row) {
    return { ok: false, error: 'invalid_token' }
  }
  const { idKey, label } = opts.log

  const now = nowDate()
  if (row.expiresAt && row.expiresAt <= now) {
    logger.info({ [idKey]: row.id }, `${label} expired`)
    return { ok: false, error: 'invalid_token' }
  }

  const { user } = row
  if (user.isAgent !== opts.agentUser || user.banned) {
    logger.info({ [idKey]: row.id, userId: user.id }, `${label} user unavailable`)
    return { ok: false, error: 'invalid_token' }
  }

  if (shouldRefreshLastUsed(row.lastUsedAt)) {
    await opts
      .touch(row.id, now)
      .catch((error: unknown) => logger.warn({ error, [idKey]: row.id }, `${label} lastUsedAt update failed`))
  }

  return {
    ok: true,
    auth: {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      scopes: [MCP_SCOPE],
      kind: opts.kind,
      clientId: row.id,
    },
  }
}
