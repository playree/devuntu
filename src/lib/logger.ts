import pino from 'pino'
import { env } from './env'

export const logger = pino({
  level: env.LOG_LEVEL || 'info',
  base: {
    service: 'devuntu',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() }
    },
  },
  redact: ['password'],

  // 開発環境のときだけ pretty-print を有効にする
  transport:
    process.env.NODE_ENV !== 'production'
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
