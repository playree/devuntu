import { DEPRECATED_PASSWORDLESS_AUTH_KEY, envu } from './env-util'
import { logger } from './logger'

/**
 * 改名した環境変数の旧名が残っていれば警告する。
 *
 * `logger` が `env-util` を読むため、警告は `env-util` の getter からは出せない。
 */
export const warnDeprecatedEnv = (): void => {
  if (envu.server.DEPRECATED_PASSWORDLESS_AUTH_SET) {
    logger.warn(
      { deprecated: DEPRECATED_PASSWORDLESS_AUTH_KEY, replacement: 'PASSWORDLESS_AUTH_ENABLED' },
      'deprecated env var is set. Rename it; the old name will be removed in a future release. The new name takes precedence when both are set',
    )
  }
}
