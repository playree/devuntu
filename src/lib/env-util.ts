import { errSystemError } from './error'

const convBoolean = (value: string | undefined, defaultValue: boolean) => {
  return value ? value.toLowerCase() !== 'false' : defaultValue
}

function getEnv<T extends string = string>(key: string, opts: { required: true }): T
function getEnv<T extends string = string>(key: string, opts: { default: T }): T
function getEnv<T extends string = string>(key: string): T | undefined
function getEnv<T extends string = string>(key: string, opts?: { required?: boolean; default?: T }): T | undefined {
  const value = process.env[key]
  if (!value) {
    if (opts?.default !== undefined) {
      return opts.default
    }
    if (opts?.required) {
      throw errSystemError(`${key} is not set`)
    }
  }
  return value as T | undefined
}

function getEnvBoolean(key: string, opts?: { default?: boolean }): boolean {
  return convBoolean(process.env[key], opts?.default ?? false)
}

function getEnvNumber(key: string, opts: { required: true }): number
function getEnvNumber(key: string, opts: { default: number }): number
function getEnvNumber(key: string): number | undefined
function getEnvNumber(key: string, opts?: { required?: boolean; default?: number }): number | undefined {
  const value = process.env[key]
  if (!value) {
    if (opts?.default !== undefined) {
      return opts.default
    }
    if (opts?.required) {
      throw errSystemError(`${key} is not set`)
    }
    return undefined
  }
  return Number(value)
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
    return getEnv('NODE_ENV')
  },
  get LOG_LEVEL() {
    return getEnv('LOG_LEVEL', { default: 'info' })
  },
  get DATABASE_URL() {
    return getEnv('DATABASE_URL', { required: true })
  },
  get DEFAULT_LOCALE() {
    return getEnv('DEFAULT_LOCALE')
  },
  get DEFAULT_TIMEZONE() {
    return getEnv('DEFAULT_TIMEZONE', { default: 'Asia/Tokyo' })
  },

  // 認証
  get BETTER_AUTH_SECRET() {
    return getEnv('BETTER_AUTH_SECRET', { required: true })
  },
  get BETTER_AUTH_URL() {
    return getEnv('BETTER_AUTH_URL', { required: true })
  },
  get SESSION_EXPIRES_IN() {
    return getEnvNumber('SESSION_EXPIRES_IN', { default: 60 * 60 * 24 * 5 })
  },
  get SESSION_FRESH_AGE() {
    return getEnvNumber('SESSION_FRESH_AGE', { default: 60 * 60 * 24 })
  },
  get TWO_FA_REQUIRED() {
    return getEnvBoolean('TWO_FA_REQUIRED', { default: true })
  },
  get DISABLE_PASSWORD_AUTH() {
    return getEnvBoolean('DISABLE_PASSWORD_AUTH')
  },
  get MAIN_DEVUNTU_URL() {
    return getEnv('MAIN_DEVUNTU_URL')
  },
  get MAIN_DEVUNTU_CLIENT_ID() {
    return getEnv('MAIN_DEVUNTU_CLIENT_ID')
  },
  get MAIN_DEVUNTU_CLIENT_SECRET() {
    return getEnv('MAIN_DEVUNTU_CLIENT_SECRET')
  },
  get GOOGLE_CLIENT_ID() {
    return getEnv('GOOGLE_CLIENT_ID')
  },
  get GOOGLE_CLIENT_SECRET() {
    return getEnv('GOOGLE_CLIENT_SECRET')
  },
  get GOOGLE_ALLOWED_DOMAINS() {
    const domains = getEnv('GOOGLE_ALLOWED_DOMAINS')
    return domains ? domains.split(',') : []
  },

  // メール
  get MAIL_SEND() {
    return getEnv<'sendgrid' | 'sendmail' | 'smtp' | 'debug'>('MAIL_SEND')
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
    return getEnvNumber('SMTP_PORT', { required: true })
  },
  get SMTP_IGNORE_TLS() {
    return getEnvBoolean('SMTP_IGNORE_TLS')
  },
  get SMTP_SECURE() {
    return getEnvBoolean('SMTP_SECURE')
  },
  get SMTP_USER() {
    return getEnv('SMTP_USER')
  },
  get SMTP_PASS() {
    return getEnv('SMTP_PASS')
  },

  // Linode
  get LINODE_ID() {
    return getEnv('LINODE_ID')
  },
  get LINODE_PERSONAL_ACCESS_TOKEN() {
    return getEnv('LINODE_PERSONAL_ACCESS_TOKEN')
  },

  // Debug
  get DEBUG_LINODE_DUMMY() {
    const value = getEnv('DEBUG_LINODE_DUMMY')
    if (!value) {
      return undefined
    }

    try {
      return JSON.parse(value)
    } catch {
      throw errSystemError(`DEBUG_LINODE_DUMMY is not valid JSON: ${value}`)
    }
  },
}

export const envu = { client, server }
