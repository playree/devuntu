import { errSystemError } from './error'

const convBoolean = (value: string | undefined, defaultValue: boolean) => {
  return value ? value.toLowerCase() !== 'false' : defaultValue
}

const client = {
  // クライアントサイド
  get NEXT_PUBLIC_APP_NAME() {
    return process.env.NEXT_PUBLIC_APP_NAME || 'Devuntu'
  },
  get NEXT_PUBLIC_URL() {
    if (!process.env.NEXT_PUBLIC_URL) {
      throw errSystemError('NEXT_PUBLIC_URL is not set')
    }
    return process.env.NEXT_PUBLIC_URL
  },
}

const server = {
  ...client,

  // サーバーサイド

  // 基本
  get NODE_ENV() {
    return process.env.NODE_ENV
  },
  get LOG_LEVEL() {
    return process.env.LOG_LEVEL ?? 'info'
  },
  get DATABASE_URL() {
    if (!process.env.DATABASE_URL) {
      throw errSystemError('DATABASE_URL is not set')
    }
    return process.env.DATABASE_URL
  },
  get DEFAULT_LOCALE() {
    return process.env.DEFAULT_LOCALE
  },

  // 認証
  get BETTER_AUTH_SECRET() {
    if (!process.env.BETTER_AUTH_SECRET) {
      throw errSystemError('BETTER_AUTH_SECRET is not set')
    }
    return process.env.BETTER_AUTH_SECRET
  },
  get TWO_FA_REQUIRED() {
    return convBoolean(process.env.TWO_FA_REQUIRED, true)
  },
  get MAIN_DEVUNTU_URL() {
    return process.env.MAIN_DEVUNTU_URL
  },
  get MAIN_DEVUNTU_CLIENT_ID() {
    return process.env.MAIN_DEVUNTU_CLIENT_ID
  },
  get MAIN_DEVUNTU_CLIENT_SECRET() {
    return process.env.MAIN_DEVUNTU_CLIENT_SECRET
  },
  get GOOGLE_CLIENT_ID() {
    return process.env.GOOGLE_CLIENT_ID
  },
  get GOOGLE_CLIENT_SECRET() {
    return process.env.GOOGLE_CLIENT_SECRET
  },

  // メール
  get MAIL_SEND() {
    return process.env.MAIL_SEND as 'sendgrid' | 'sendmail' | 'smtp' | 'debug' | undefined
  },
  get MAIL_FROM() {
    if (!process.env.MAIL_FROM) {
      throw errSystemError('MAIL_FROM is not set')
    }
    return process.env.MAIL_FROM
  },
  get SENDGRID_API_KEY() {
    if (!process.env.SENDGRID_API_KEY) {
      throw errSystemError('SENDGRID_API_KEY is not set')
    }
    return process.env.SENDGRID_API_KEY
  },
  get SENDMAIL_PATH() {
    if (!process.env.SENDMAIL_PATH) {
      throw errSystemError('SENDMAIL_PATH is not set')
    }
    return process.env.SENDMAIL_PATH
  },
  get SMTP_HOST() {
    if (!process.env.SMTP_HOST) {
      throw errSystemError('SMTP_HOST is not set')
    }
    return process.env.SMTP_HOST
  },
  get SMTP_PORT() {
    if (!process.env.SMTP_PORT) {
      throw errSystemError('SMTP_PORT is not set')
    }
    return Number(process.env.SMTP_PORT)
  },
  get SMTP_IGNORE_TLS() {
    return convBoolean(process.env.SMTP_IGNORE_TLS, false)
  },
  get SMTP_SECURE() {
    return convBoolean(process.env.SMTP_SECURE, false)
  },
  get SMTP_USER() {
    return process.env.SMTP_USER
  },
  get SMTP_PASS() {
    return process.env.SMTP_PASS
  },
}

export const envu = { client, server }

export const makeUrl = (path: string, params?: Record<string, string>) => {
  const url = new URL(path, client.NEXT_PUBLIC_URL)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value)
    })
  }
  return url
}
