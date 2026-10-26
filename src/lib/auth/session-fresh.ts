/**
 * セッションの鮮度チェック(サーバー専用)
 *
 * better-auth の freshSessionMiddleware は `/api/auth/*` を通るエンドポイントにしか掛からない。
 * Server Action から強い資格情報を発行する経路も同じ歯止めを掛けたいので、同じ判定式をここに持つ。
 */

import { envu } from '../env-util'
import { errClient } from '../error'
import { SESSION_NOT_FRESH } from './auth-config'

/**
 * ログインからの経過時間が `SESSION_FRESH_AGE` 未満であることを要求する。
 * `0` はチェック無効(better-auth の freshAge と同じ扱い)。
 */
export const assertFreshSession = (session: { createdAt: Date }): void => {
  const freshAge = envu.server.SESSION_FRESH_AGE
  if (freshAge === 0) {
    return
  }
  if (Date.now() - session.createdAt.getTime() >= freshAge * 1000) {
    throw errClient(SESSION_NOT_FRESH)
  }
}
