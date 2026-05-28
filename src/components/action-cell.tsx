import { useLocale } from '@/locale/client'
import { ButtonProps, Table } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { MultiButton } from './general/button'
import { useConfirmModal } from './general/modal'
import { TrashIcon } from './icon'

export const ActionCell: FC<{
  items: (
    | {
        template: 'none'
        key: string
        icon: ReactNode
        tooltip?: string
        variant?: ButtonProps['variant']
        onPress?: () => void
      }
    | {
        template: 'delete'
        target: string
        action: () => Promise<void>
      }
  )[]
}> = ({ items }) => {
  const { t } = useLocale()
  const { confirmModal } = useConfirmModal()

  return (
    <Table.Cell className='py-2'>
      <div className='flex items-center gap-0.5'>
        {items.map((item) => {
          if (item.template === 'delete') {
            const { target, action } = item
            return (
              <MultiButton
                key='delete'
                variant='danger-soft'
                tooltip={t('delete')}
                onPress={async () => {
                  try {
                    const ok = await confirmModal().confirm({
                      title: t('confirm_deletion'),
                      text: t('msg_confirm_deletion', { target }),
                      requireCheck: true,
                      autoClose: false,
                    })
                    if (ok) {
                      await action()
                    }
                  } finally {
                    confirmModal().close()
                  }
                }}
                isIconOnly
                size='sm'
                className='h-7 w-7 rounded-sm'
              >
                <TrashIcon />
              </MultiButton>
            )
          }

          return (
            <MultiButton
              key={item.key}
              variant={item.variant || 'tertiary'}
              onPress={item.onPress}
              isIconOnly
              size='sm'
              className='h-7 w-7 rounded-sm'
              tooltip={item.tooltip}
            >
              {item.icon}
            </MultiButton>
          )
        })}
      </div>
    </Table.Cell>
  )
}
