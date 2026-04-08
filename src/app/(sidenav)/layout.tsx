import { FC, ReactNode } from 'react'

import { SideNavbar } from '@/components/general/side-navbar'
import { createMenu } from './menu'

const SideNavLayout: FC<{ children: ReactNode }> = async ({ children }) => {
  return (
    <SideNavbar menu={createMenu} className='bg-white dark:bg-black'>
      <div className='mx-auto max-w-4xl px-2 lg:px-0'>{children}</div>
    </SideNavbar>
  )
}
export default SideNavLayout
