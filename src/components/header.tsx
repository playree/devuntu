import { ButtonGroup } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { Grid } from './general/grid'

export const ContentHeader: FC<{
  children?: ReactNode
  icon?: ReactNode
  title?: string
}> = ({ children, icon, title }) => {
  return (
    <Grid className='mb-2 min-h-9'>
      <div className='col-span-12 flex items-center justify-center gap-2 lg:col-span-6 lg:justify-start'>
        {icon}
        {title}
      </div>
      <div className='col-span-12 flex justify-end gap-2 lg:col-span-6'>
        {children && <ButtonGroup variant='tertiary'>{children}</ButtonGroup>}
      </div>
    </Grid>
  )
}
