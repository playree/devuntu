import { FC, ReactNode } from 'react'

import { SideNavbar } from '@/components/general/side-navbar'
import { createMenu } from './menu'
import { getPendding } from './pendding'

const SideNavLayout: FC<{ children: ReactNode }> = async ({ children }) => {
  return (
    <>
      <SideNavbar menu={createMenu} pendding={getPendding} className='bg-white dark:bg-black'>
        <div className='mx-auto max-w-4xl px-2 lg:px-0'>{children}</div>
      </SideNavbar>
    </>
  )
}
export default SideNavLayout
