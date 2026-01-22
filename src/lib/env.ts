import { errSystemError } from './error'

export const env = {
  get DATABASE_URL() {
    if (!process.env.DATABASE_URL) {
      throw errSystemError('DATABASE_URL is not set')
    }
    return process.env.DATABASE_URL
  },
  get BETTER_AUTH_URL() {
    if (!process.env.BETTER_AUTH_URL) {
      throw errSystemError('BETTER_AUTH_URL is not set')
    }
    return process.env.BETTER_AUTH_URL
  },
  get BETTER_AUTH_SECRET() {
    if (!process.env.BETTER_AUTH_SECRET) {
      throw errSystemError('BETTER_AUTH_SECRET is not set')
    }
    return process.env.BETTER_AUTH_SECRET
  },
}
