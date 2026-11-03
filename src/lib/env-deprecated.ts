import { DEPRECATED_PASSWORDLESS_AUTH_KEY, envu } from './env-util'
import { logger } from './logger'

/**
 * 改名した環境変数の旧名が残っていれば警告する。
 *
 * `logger` が `env-util` を読むため、警告は `env-util` の getter からは出せない。
 */
export const warnDeprecatedEnv = (): void => {
  if (envu.server.DEPRECATED_PASSWORDLESS_AUTH_SET) {
    // 新名も設定済みなら旧名は効いていない。どちらの値が効いているかを取り違えないよう書き分ける
    const replacementSet = Boolean(process.env.PASSWORDLESS_AUTH_ENABLED?.trim())
    logger.warn(
      {
        deprecated: DEPRECATED_PASSWORDLESS_AUTH_KEY,
        replacement: 'PASSWORDLESS_AUTH_ENABLED',
        passwordless: envu.server.PASSWORDLESS_AUTH_ENABLED,
      },
      replacementSet
        ? 'deprecated env var is ignored because the new name is set. Remove the old name'
        : 'deprecated env var is in effect. Rename it; the old name will be removed in a future release',
    )
  }
}
