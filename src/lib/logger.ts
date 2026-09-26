import pino from 'pino'
import { envu } from './env-util'

/**
 * ログに出さないキー。pino の `*` は1階層だけに当たるので、
 * Server Action の input(`{ input: { password } }`)など入れ子になる深さぶん並べる
 */
export const LOG_REDACT_PATHS = ['password', 'client_secret', 'token'].flatMap((key) => [key, `*.${key}`, `*.*.${key}`])

export const logger = pino({
  level: envu.server.LOG_LEVEL || 'info',
  base: {
    service: 'devuntu',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() }
    },
  },
  redact: LOG_REDACT_PATHS,

  // 開発環境のときだけ pretty-print を有効にする
  transport:
    envu.server.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'service',
          },
        }
      : undefined,
})
