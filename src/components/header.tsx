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
  /** lg 以上でボタン側を中身の幅に詰め、残りをタイトル側に使う(パンくずなど横に長い表示向け) */
  isTitleWide?: boolean
}> = ({ children, icon, title, className, buttonVariant = 'outline', extra, isTitleWide }) => {
  const hasRight = Boolean(children || extra)
  const isWide = isTitleWide && hasRight
  return (
    <Grid className={cn('min-h-9', isWide && 'lg:grid-cols-[minmax(0,1fr)_auto]', className)}>
      <div // 右側に何も無いときはタイトル側を全幅にする(パンくずなど横に長い表示のため)
        className={cn(
          'col-span-12 flex min-w-0 items-center justify-center gap-2 lg:justify-start',
          hasRight && (isWide ? 'lg:col-span-1' : 'lg:col-span-6'),
        )}
      >
        {icon}
        {title}
      </div>
      <div
        className={cn('col-span-12 flex items-center justify-end gap-2', isWide ? 'lg:col-span-1' : 'lg:col-span-6')}
      >
        {extra}
        {children && <ButtonGroup variant={buttonVariant}>{children}</ButtonGroup>}
      </div>
    </Grid>
  )
}
