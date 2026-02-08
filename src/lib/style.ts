import { tv } from 'tailwind-variants'

export const gridStyles = tv({
  base: 'grid grid-cols-12 gap-2',
})

export const textStyles = tv({
  slots: {
    light: 'text-gray-600 dark:text-gray-400',
  },
})
