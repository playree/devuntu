import { ButtonGroup, ButtonGroupProps, cn } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { Grid } from './general/grid'

export const ContentHeader: FC<{
  children?: ReactNode
  icon?: ReactNode
  title?: ReactNode
  className?: string
  buttonVariant?: ButtonGroupProps['variant']
  /** ボタン以外の操作(スイッチなど)。ButtonGroup の外側・左隣に置く */
  extra?: ReactNode
}> = ({ children, icon, title, className, buttonVariant = 'outline', extra }) => {
  return (
    <Grid className={cn('min-h-9', className)}>
      <div // 右側に何も無いときはタイトル側を全幅にする(パンくずなど横に長い表示のため)
        className={cn(
          'col-span-12 flex min-w-0 items-center justify-center gap-2 lg:justify-start',
          (children || extra) && 'lg:col-span-6',
        )}
      >
        {icon}
        {title}
      </div>
      <div className='col-span-12 flex items-center justify-end gap-2 lg:col-span-6'>
        {extra}
        {children && <ButtonGroup variant={buttonVariant}>{children}</ButtonGroup>}
      </div>
    </Grid>
  )
}
