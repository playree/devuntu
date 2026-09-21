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
   * ランタイム判定を通った後に動的 import する。
   *
   * メンテナンスモードの監視を最初に起動するのは、以降の初期化が DB を触ってよいかの判断が
   * ここに依存するため。
   */
  const { isMaintenanceMode, startMaintenanceModeWatcher } = await import('./lib/maintenance/maintenance-mode')
  startMaintenanceModeWatcher()

  // 起動時点で遮断中なら DB へ触らない(観測目的の記録のためにリストア中の接続を張り直さない)
  if (!isMaintenanceMode()) {
    const { recordAppVersion } = await import('./lib/app-version')
    await recordAppVersion()
  }

  const { startNotifyWorker } = await import('./lib/notify/notify-worker')
  startNotifyWorker()

  const { startMaintenanceWorker } = await import('./lib/maintenance/maintenance-worker')
  startMaintenanceWorker()

  const { startCommandWorker } = await import('./lib/command/command-worker')
  startCommandWorker()
}
