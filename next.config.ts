import type { NextConfig } from 'next'

const genBuildNo = () => {
  // JST(+9)固定で YYYYMMDDHHmm を生成
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const p = (n: number, d = 2) => String(n).padStart(d, '0')
  return `${jst.getUTCFullYear()}${p(jst.getUTCMonth() + 1)}${p(jst.getUTCDate())}${p(jst.getUTCHours())}${p(jst.getUTCMinutes())}`
}

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
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
