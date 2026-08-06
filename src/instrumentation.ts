/**
 * Next.js の instrumentation。サーバーインスタンスの起動時に1度だけ呼ばれる。
 */
export const register = async () => {
  // Edge Runtime のインスタンスでも呼ばれるため、prisma を使える Node.js ランタイムに限定する
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return
  }

  /**
   * トップレベル import にすると Edge 用バンドルにも含まれてしまい、
   * さらに `src/lib/prisma.ts` がモジュール評価時に DATABASE_URL(required)を要求するため、
   * ランタイム判定を通った後に動的 import する
   */
  const { recordAppVersion } = await import('./lib/app-version')
  await recordAppVersion()
}
