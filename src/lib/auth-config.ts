import { type MatchCondition } from './match'

export type AuthConfig = {
  path: {
    signIn: string
    twoFactor: string
  }
  target: {
    auth?: MatchCondition
    admin?: MatchCondition
    twoFactor?: MatchCondition
  }
}

export const authConfig: AuthConfig = {
  path: {
    signIn: '/auth/signin',
    twoFactor: '/auth/twofa',
  },
  target: {
    auth: {
      exclude: ['/auth/signin', '/start'],
    },
    admin: {
      require: ['/admin/:path'],
    },
    twoFactor: {
      exclude: ['/auth/twofa'],
    },
  },
} as const
