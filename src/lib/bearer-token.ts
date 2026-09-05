/**
 * Bearer 認証で使う長期トークンの共通処理(サーバー専用)
 *
 * エージェント用(`agent/agent-token.ts`)とユーザー用(`mcp/mcp-token.ts`)で
 * 生成・保存の形式を揃えるために切り出してある。どちらの検証も
 * `Authorization: Bearer` に載った平文をハッシュ化して DB の1行と突き合わせる。
 *
 * 検証そのものは引くテーブルもユーザーの判定条件も違うので、ここには置かない。
 */

import { nanoid } from 'nanoid'
import { createHash } from 'node:crypto'
import { withinMinutes } from './day'

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
