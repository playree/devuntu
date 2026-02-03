import { errSystemError } from './error'

const client = {
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

  get NODE_ENV() {
    return process.env.NODE_ENV
  },
  get LOG_LEVEL() {
    return process.env.LOG_LEVEL
  },
  get DATABASE_URL() {
    if (!process.env.DATABASE_URL) {
      throw errSystemError('DATABASE_URL is not set')
    }
    return process.env.DATABASE_URL
  },
  get BETTER_AUTH_SECRET() {
    if (!process.env.BETTER_AUTH_SECRET) {
      throw errSystemError('BETTER_AUTH_SECRET is not set')
    }
    return process.env.BETTER_AUTH_SECRET
  },
  get DEFAULT_LOCALE() {
    return process.env.DEFAULT_LOCALE
  },
  get GOOGLE_CLIENT_ID() {
    return process.env.GOOGLE_CLIENT_ID
  },
  get GOOGLE_CLIENT_SECRET() {
    return process.env.GOOGLE_CLIENT_SECRET
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
