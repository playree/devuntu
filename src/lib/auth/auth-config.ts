import { type MatchCondition } from '../match'

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
      // '/cal/:id' はカレンダー空き時間の公開共有ページ(ログイン不要)
      // ':id' は1セグメント必須のため、管理ページ '/cal'(認証必須)はマッチしない
      exclude: ['/auth/signin', '/start', '/cal/:id'],
    },
    admin: {
      // ':path' は1セグメントしかマッチしないため、ネストしたルートも含む '*path'(0セグメント以上)で受ける
      require: ['/admin{/*path}'],
    },
    twoFactor: {
      exclude: ['/auth/twofa'],
    },
  },
} as const
