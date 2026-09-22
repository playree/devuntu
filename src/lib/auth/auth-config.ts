import { type MatchCondition } from '../match'

/**
 * セッションが新しくないため再認証が必要。
 * 値は better-auth の BASE_ERROR_CODES と揃えてあり、パスキー登録(better-auth の APIError 由来)と
 * Server Action(自前の ClientError 由来)を同じキーで分岐できる。
 */
export const SESSION_NOT_FRESH = 'SESSION_NOT_FRESH'

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
      // '/maintenance' はメンテナンスモードの rewrite 先(遮断中はセッションを引けない)
      exclude: ['/auth/signin', '/start', '/cal/:id', '/maintenance'],
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

/**
 * Proxy が認証処理を通さないパスか。
 *
 * もとは Proxy の matcher 側の除外だったものを、メンテナンスモードの遮断を全経路へ届かせるために
 * こちらへ移した(matcher から外れたパスは Proxy 自体が動かず、遮断もできないため)。
 * ここに当たるパスは「画面ではない」ので、認可はそれぞれのハンドラ側が持つ。
 *
 * - `/api/**` : ルートハンドラ。レコード単位の認可は各ハンドラで行う
 * - `/.well-known/**` : OIDC / RFC 8414・9728 のメタデータ。末尾に拡張子が無いので拡張子判定では拾えない
 * - 末尾に拡張子があるもの : `/sw.js` `/robots.txt` `/manifest.webmanifest` `/agent/devuntu_agent.py` など。
 *   `/api/upload/<uuidv7>.webp` のようなルートハンドラもここに当たるが、どちらにせよ素通しでよい
 */
export const isProxyAuthBypassPath = (pathname: string): boolean =>
  pathname.startsWith('/api/') || pathname.startsWith('/.well-known/') || /\.[^/]+$/.test(pathname)
