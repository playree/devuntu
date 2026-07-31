import { ComponentProps, FC } from 'react'
import { tv } from 'tailwind-variants'

export type PanelVariant = 'border' | 'shadow'

const panelStyles = tv({
  base: 'rounded-xl bg-stone-100 p-3 dark:bg-mist-950',
  variants: {
    variant: {
      border: 'border',
      shadow: 'shadow-md dark:border-t-2 dark:border-mist-900',
    },
  },
  defaultVariants: { variant: 'border' },
})

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
