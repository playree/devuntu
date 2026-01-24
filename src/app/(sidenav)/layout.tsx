import { FC, ReactNode } from 'react'

import { SideNavbar } from '@/components/general/side-navbar'
import { createMenu } from './menu'

const SideNavLayout: FC<{ children: ReactNode }> = async ({ children }) => {
  return (
    <SideNavbar menu={createMenu} className='bg-white dark:bg-black'>
      <div className='mx-auto max-w-6xl'>{children}</div>
    </SideNavbar>
  )
}
export default SideNavLayout
