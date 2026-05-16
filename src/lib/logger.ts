import pino from 'pino'
import { envu } from './env-util'

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
  redact: ['password', 'client_secret'],

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
