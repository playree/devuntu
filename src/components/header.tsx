import { ButtonGroup, ButtonGroupProps, cn } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { Grid } from './general/grid'

export const ContentHeader: FC<{
  children?: ReactNode
  icon?: ReactNode
  title?: ReactNode
  className?: string
  buttonVariant?: ButtonGroupProps['variant']
}> = ({ children, icon, title, className, buttonVariant = 'outline' }) => {
  return (
    <Grid className={cn('min-h-9', className)}>
      <div // 右側にボタンが無いときはタイトル側を全幅にする(パンくずなど横に長い表示のため)
        className={cn(
          'col-span-12 flex min-w-0 items-center justify-center gap-2 lg:justify-start',
          children && 'lg:col-span-6',
        )}
      >
        {icon}
        {title}
      </div>
      <div className='col-span-12 flex justify-end gap-2 lg:col-span-6'>
        {children && <ButtonGroup variant={buttonVariant}>{children}</ButtonGroup>}
      </div>
    </Grid>
  )
}
