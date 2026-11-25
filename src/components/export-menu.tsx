'use client'

import { MultiButton } from '@/components/general/button'
import { ArrowDownTrayIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { ButtonProps, Dropdown, Label } from '@heroui/react'
import { ReactNode } from 'react'

export type ExportMenuItem<K extends string> = { id: K; label: string; icon: ReactNode }

/** 出力形式を選ぶメニュー(チケット・Wiki の PDF / HTML などの出力) */
export const ExportMenu = <K extends string>({
  items,
  onAction,
  variant,
  className,
  disabledIds,
  isPending,
}: {
  items: ExportMenuItem<K>[]
  onAction: (id: K) => void
  variant?: ButtonProps['variant']
  className?: string
  /** いまは選べない形式 */
  disabledIds?: K[]
  /** 出力ファイルを作っている間。ボタンにスピナーを出し、押せなくする */
  isPending?: boolean
}) => {
  const { t } = useLocale()
  return (
    <Dropdown>
      <MultiButton
        isIconOnly
        size='sm'
        variant={variant}
        className={className}
        tooltip={t('export')}
        icon={<ArrowDownTrayIcon width={16} />}
        isPending={isPending}
      />
      <Dropdown.Popover placement='bottom end'>
        <Dropdown.Menu disabledKeys={disabledIds} onAction={(key) => onAction(key as K)}>
          {items.map((item) => (
            <Dropdown.Item key={item.id} id={item.id} textValue={item.label}>
              {item.icon}
              <Label>{item.label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
