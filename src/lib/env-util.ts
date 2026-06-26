import { errSystemError } from './error'

const convBoolean = (value: string | undefined, defaultValue: boolean) => {
  return value ? value.toLowerCase() !== 'false' : defaultValue
}

function getEnv(key: string, opts: { required: true }): string
function getEnv(key: string): string | undefined
function getEnv(key: string, opts?: { required?: boolean }): string | undefined {
  const value = process.env[key]
  if (!value && opts?.required) {
    throw errSystemError(`${key} is not set`)
  }
  return value
}

const client = {
  // クライアントサイド
  get NEXT_PUBLIC_APP_NAME() {
    return process.env.NEXT_PUBLIC_APP_NAME || 'Devuntu'
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
    return getEnv('DATABASE_URL', { required: true })
  },
  get DEFAULT_LOCALE() {
    return process.env.DEFAULT_LOCALE
  },

  // 認証
  get BETTER_AUTH_SECRET() {
    return getEnv('BETTER_AUTH_SECRET', { required: true })
  },
  get BETTER_AUTH_URL() {
    return getEnv('BETTER_AUTH_URL', { required: true })
  },
  get SESSION_EXPIRES_IN() {
    if (!process.env.SESSION_EXPIRES_IN) {
      return 60 * 60 * 24 * 5
    }
    return Number(process.env.SESSION_EXPIRES_IN)
  },
  get SESSION_FRESH_AGE() {
    if (!process.env.SESSION_FRESH_AGE) {
      return 60 * 60 * 24
    }
    return Number(process.env.SESSION_FRESH_AGE)
  },
  get TWO_FA_REQUIRED() {
    return convBoolean(process.env.TWO_FA_REQUIRED, true)
  },
  get DISABLE_PASSWORD_AUTH() {
    return convBoolean(process.env.DISABLE_PASSWORD_AUTH, false)
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
  get GOOGLE_ALLOWED_DOMAINS() {
    const domains = process.env.GOOGLE_ALLOWED_DOMAINS
    return domains ? domains.split(',') : []
  },

  // メール
  get MAIL_SEND() {
    return process.env.MAIL_SEND as 'sendgrid' | 'sendmail' | 'smtp' | 'debug' | undefined
  },
  get MAIL_FROM() {
    return getEnv('MAIL_FROM', { required: true })
  },
  get SENDGRID_API_KEY() {
    return getEnv('SENDGRID_API_KEY', { required: true })
  },
  get SENDMAIL_PATH() {
    return getEnv('SENDMAIL_PATH', { required: true })
  },
  get SMTP_HOST() {
    return getEnv('SMTP_HOST', { required: true })
  },
  get SMTP_PORT() {
    return Number(getEnv('SMTP_PORT', { required: true }))
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
