import { tv } from 'tailwind-variants'

export const textStyles = tv({
  slots: {
    light: 'text-gray-600 dark:text-gray-400',
    superlight: 'text-gray-400 dark:text-gray-600',
  },
})
