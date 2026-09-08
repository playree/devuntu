import { envu } from '@/lib/env-util'
import type { MetadataRoute } from 'next'

/**
 * 配布物は事前ビルド済みイメージで環境変数はコンテナ起動時に渡るため、
 * 既定のプリレンダ(ビルド時に内容が固定される)を止めてリクエスト時に評価する。
 */
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  if (!envu.server.SEARCH_ENGINE_INDEXING) {
    return { rules: { userAgent: '*', disallow: '/' } }
  }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      /**
       * 認証必須パスは列挙しない。クロールしてもサインインへリダイレクトされるだけで、
       * 書くと auth-config.ts の設定と二重管理になる。
       * /api/ は非HTMLの応答、/cal/ は共有URLを知る人だけが見る想定。
       */
      disallow: ['/api/', '/cal/'],
    },
  }
}
