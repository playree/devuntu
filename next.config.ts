import type { NextConfig } from 'next'

const genBuildNo = () => {
  // JST(+9)固定で YYYYMMDDHHmm を生成
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const p = (n: number, d = 2) => String(n).padStart(d, '0')
  return `${jst.getUTCFullYear()}${p(jst.getUTCMonth() + 1)}${p(jst.getUTCDate())}${p(jst.getUTCHours())}${p(jst.getUTCMinutes())}`
}

/**
 * 全ルートへ付与するセキュリティヘッダ。
 *
 * CSP は frame-ancestors だけに絞ってある。script-src まで縛るには Next.js のインラインスクリプトへ
 * nonce を通す必要があり、MDXEditor / HeroUI のインラインスタイルも巻き込むため別対応とする。
 * 自身が OIDC プロバイダで /consent と /auth/signin を提供する以上、frame 埋め込みの禁止は必須。
 * X-Frame-Options は frame-ancestors 非対応の古いブラウザ向けの重複指定。
 */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // HTTPS 応答でのみ解釈されるため、http で動かす開発環境には影響しない
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
]

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
  env: {
    BUILD_NO: genBuildNo(),
  },
  experimental: {
    serverActions: {
      // 既定は1MB。schema.ts の MAX_IMAGE_SIZE(5MB)まで Server Action で受け取れるようにする
      bodySizeLimit: '6mb',
    },
    /**
     * typescript は @typescript/typescript6 のエイリアス(tsc バイナリを持たず tsc6 のみ)なので、
     * 既定の CLI チェッカーだと tsc を解決できずビルドが止まる。JS API チェッカーを使う。
     * TS7 での高速な型チェックは `pnpm typecheck`(@typescript/native の tsc)で行う。
     */
    useTypeScriptCli: false,
  },
}

export default nextConfig
