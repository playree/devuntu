import { cookies } from 'next/headers'
import { FC, ReactNode } from 'react'

import { parseSideNavWidth, SIDE_NAV_WIDTH_COOKIE } from '@/components/general/side-nav-width'
import { SideNavbar } from '@/components/general/side-navbar'
import { MaxFileSizeProvider } from '@/components/markdown/upload-limit'
import { getServerSession } from '@/lib/auth/auth'
import { canUseAnyCommand } from '@/lib/command/command-access'
import { envu } from '@/lib/env-util'
import { canUseGoogleAccount } from '@/lib/google/google-account'
import { CommandAvailableProvider, createMenu, GoogleAvailableProvider } from './menu'
import { SessionPending } from './pending'

const SideNavLayout: FC<{ children: ReactNode }> = async ({ children }) => {
  // メニューのカレンダー表示制御。クライアントから問い合わせずここで解決して渡す
  const session = await getServerSession()
  const [googleAvailable, commandAvailable] = session
    ? await Promise.all([canUseGoogleAccount(session.user.id), canUseAnyCommand(session.user)])
    : [false, false]
  // 保存した幅で初回から描画し、ハイドレーション後に幅が跳ねないようにする
  const sideNavWidth = parseSideNavWidth((await cookies()).get(SIDE_NAV_WIDTH_COOKIE)?.value)

  return (
    <GoogleAvailableProvider value={googleAvailable}>
      <CommandAvailableProvider value={commandAvailable}>
        <MaxFileSizeProvider value={envu.server.ATTACHMENT_MAX_SIZE_MB}>
          <SessionPending>
            <SideNavbar menu={createMenu} defaultWidth={sideNavWidth}>
              <div // 子が data-wide のときだけ幅制限を外し、data-fit-screen のときは #side-main の高さも子へ通す
                className='mx-auto max-w-4xl px-2 has-data-wide:max-w-none md:has-data-fit-screen:h-full lg:px-0'
              >
                {children}
              </div>
            </SideNavbar>
          </SessionPending>
        </MaxFileSizeProvider>
      </CommandAvailableProvider>
    </GoogleAvailableProvider>
  )
}
export default SideNavLayout
