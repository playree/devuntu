import { type Metadata } from 'next'
import { FC } from 'react'
import { MaintenanceClient } from './client'

export const metadata: Metadata = {
  title: 'Maintenance',
  robots: { index: false, follow: false },
}

/**
 * メンテナンス中の案内。
 *
 * 遮断中は `src/proxy.ts` がこのパスへ 503 で rewrite する(URL は元のまま)。
 * DB リストア中でも表示できる必要があるため、DB もセッションも引かない。
 */
const MaintenancePage: FC = () => {
  return <MaintenanceClient />
}
export default MaintenancePage
