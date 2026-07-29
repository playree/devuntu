import { FC, ReactNode } from 'react'

import { SideNavbar } from '@/components/general/side-navbar'
import { createMenu } from './menu'
import { getPendding } from './pendding'

const SideNavLayout: FC<{ children: ReactNode }> = async ({ children }) => {
  return (
    <>
      <SideNavbar menu={createMenu} pendding={getPendding}>
        {/* 子が data-wide を持つときだけ幅制限を外す(かんばんのような全幅ページ向け) */}
        <div className='mx-auto max-w-4xl px-2 has-data-wide:max-w-none lg:px-0'>{children}</div>
      </SideNavbar>
    </>
  )
}
export default SideNavLayout
