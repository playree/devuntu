import { envu } from '@/lib/env-util'
import type { MetadataRoute } from 'next'

/**
 * 配布物は事前ビルド済みイメージで環境変数はコンテナ起動時に渡るため、
 * 既定のプリレンダ(ビルド時に内容が固定される)を止めてリクエスト時に評価する。
 */
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  /**
   * 全パスを Disallow にするとページ本体が取得されず noindex が読まれないため、
   * インデックスを消したい場合は SEARCH_ENGINE_ROBOTS_ALLOW だけ true にしてクロールを通す。
   * SEARCH_ENGINE_INDEXING=true は載せる意思表示なのでクロール許可も含む。
   */
  if (!envu.server.SEARCH_ENGINE_INDEXING && !envu.server.SEARCH_ENGINE_ROBOTS_ALLOW) {
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
