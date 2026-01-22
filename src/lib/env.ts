import { errSystemError } from './error'

export const env = {
  get DATABASE_URL() {
    if (!process.env.DATABASE_URL) {
      throw errSystemError('DATABASE_URL is not set')
    }
    return process.env.DATABASE_URL
  },
}
