import { FC, ReactNode } from 'react'

import { SideNavbar } from '@/components/general/side-navbar'
import { getServerSession } from '@/lib/auth/auth'
import { ensurePrivateBoard } from '@/lib/board/board'
import { canUseAnyCommand } from '@/lib/command/command-access'
import { canUseGoogleAccount } from '@/lib/google/google-account'
import { CommandAvailableProvider, createMenu, GoogleAvailableProvider } from './menu'
import { SessionPending } from './pending'

const SideNavLayout: FC<{ children: ReactNode }> = async ({ children }) => {
  // メニューのカレンダー表示制御。クライアントから問い合わせずここで解決して渡す
  const session = await getServerSession()
  const [googleAvailable, commandAvailable] = session
    ? await Promise.all([
        canUseGoogleAccount(session.user.id),
        canUseAnyCommand(session.user),
        /**
         * プライベートチケットもボード経由で可視化するため、どの画面の読み取りより先に
         * プライベートボードを用意しておく(一覧・選択肢の取得はここで作られている前提で読むだけにする)
         */
        ensurePrivateBoard(session.user),
      ])
    : [false, false]

  return (
    <GoogleAvailableProvider value={googleAvailable}>
      <CommandAvailableProvider value={commandAvailable}>
        <SessionPending>
          <SideNavbar menu={createMenu}>
            <div // 子が data-wide のときだけ幅制限を外し、data-fit-screen のときは #side-main の高さも子へ通す
              className='mx-auto max-w-4xl px-2 has-data-wide:max-w-none md:has-data-fit-screen:h-full lg:px-0'
            >
              {children}
            </div>
          </SideNavbar>
        </SessionPending>
      </CommandAvailableProvider>
    </GoogleAvailableProvider>
  )
}
export default SideNavLayout
