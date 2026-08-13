import { Skeleton } from '@heroui/react'
import { ComponentProps, FC } from 'react'
import { tv } from 'tailwind-variants'

export type PanelVariant = 'border' | 'shadow'

const panelStyles = tv({
  base: 'rounded-xl bg-stone-100 px-3 py-2 dark:bg-mist-950',
  variants: {
    variant: {
      border: 'border',
      shadow: 'border-t-2 border-mist-200 dark:border-mist-900',
    },
  },
  defaultVariants: { variant: 'border' },
})

const skeletonStyles = tv({ base: 'min-h-48 w-full rounded-xl' })

const noticeStyles = tv({ base: 'rounded-xl border-2 p-4 text-sm' })

/**
 * 情報をひとまとめにするサーフェス。
 * 背景色を一段変えて周囲と区切る。padding などは className で上書きする。
 */
export const Panel: FC<ComponentProps<'div'> & { variant?: PanelVariant }> = ({
  children,
  className,
  variant = 'border',
  ...props
}) => (
  <div className={panelStyles({ variant, className })} {...props}>
    {children}
  </div>
)

/**
 * データ取得中のプレースホルダ。
 * Panel と同じ角丸にして、取得完了で中身へ差し替わるときに輪郭が動かないようにする。
 */
export const PanelSkeleton: FC<{ className?: string }> = ({ className }) => (
  <Skeleton className={skeletonStyles({ className })} />
)

/**
 * 権限不足やデータ無しを本文の代わりに伝える枠。
 * Panel と違い背景色を持たず、枠線だけで「中身が無い」ことを示す。
 */
export const NoticePanel: FC<ComponentProps<'div'>> = ({ children, className, ...props }) => (
  <div className={noticeStyles({ className })} {...props}>
    {children}
  </div>
)
