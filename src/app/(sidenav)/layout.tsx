import { FC, ReactNode } from 'react'

import { SideNavbar } from '@/components/general/side-navbar'
import { getServerSession } from '@/lib/auth'
import { canUseGoogleAccount } from '@/lib/google-account'
import { createMenu, GoogleAvailableProvider } from './menu'
import { getPendding } from './pendding'

const SideNavLayout: FC<{ children: ReactNode }> = async ({ children }) => {
  // メニューのカレンダー表示制御。クライアントから問い合わせずここで解決して渡す
  const session = await getServerSession()
  const googleAvailable = session ? await canUseGoogleAccount(session.user.id) : false

  return (
    <GoogleAvailableProvider value={googleAvailable}>
      <SideNavbar menu={createMenu} pendding={getPendding}>
        <div // 子が data-wide を持つときだけ幅制限を外す(かんばんのような全幅ページ向け)
          className='mx-auto max-w-4xl px-2 has-data-wide:max-w-none lg:px-0'
        >
          {children}
        </div>
      </SideNavbar>
    </GoogleAvailableProvider>
  )
}
export default SideNavLayout
