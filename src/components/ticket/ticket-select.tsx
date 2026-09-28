'use client'

import { FieldError } from '@/components/general/field'
import { useSmart } from '@/components/general/smart'
import { StatusChip, TicketIdText } from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { useLocale } from '@/locale/client'
import { ComboBox, EmptyState, Input, ListBox, cn } from '@heroui/react'
import { FC } from 'react'

/** 候補のチケット。表示ID は呼び出し側(サーバー)で組み立てたものを渡す */
export type TicketSelectOption = { id: string; displayId: string; title: string; status: TicketStatus }

/**
 * チケットを表示ID / 件名で探して選ぶ入力欄。候補の絞り込みは呼び出し側(サーバー検索)で済ませる前提で、
 * ComboBox 内蔵の絞り込みは使わない。候補を選ばずに入力した文字列(表示ID や番号)もそのまま値として残す
 */
export const TicketSelectField: FC<{
  options: TicketSelectOption[]
  inputValue: string
  onInputChange: (value: string) => void
  onSelect: (option: TicketSelectOption) => void
  isLoading?: boolean
  placeholder?: string
  errorMessage?: string
  isSmart?: boolean
  'aria-label': string
}> = ({
  options,
  inputValue,
  onInputChange,
  onSelect,
  isLoading = false,
  placeholder,
  errorMessage,
  isSmart: isSmartProp,
  'aria-label': ariaLabel,
}) => {
  const { t } = useLocale()
  const { isCompact, hasErrorArea } = useSmart(isSmartProp)

  return (
    <ComboBox
      aria-label={ariaLabel}
      items={options}
      inputValue={inputValue}
      onInputChange={onInputChange}
      // 選んだ候補は呼び出し側が入力欄へ反映するので、選択状態は持たない
      value={null}
      onChange={(key) => {
        const option = options.find((item) => item.id === key)
        if (option) {
          onSelect(option)
        }
      }}
      defaultFilter={() => true}
      allowsCustomValue
      // 入力前でも最近のチケットを候補に出せるよう、フォーカスで開く
      menuTrigger='focus'
      allowsEmptyCollection
      isInvalid={!!errorMessage}
      fullWidth
    >
      <ComboBox.InputGroup>
        <Input className={cn(isCompact ? 'min-h-7 py-1' : undefined)} placeholder={placeholder} />
        <ComboBox.Trigger /* 必ず最後の子にすること(InputGroup が最後の子を Trigger として扱う) */ />
      </ComboBox.InputGroup>
      <FieldError hasErrorArea={hasErrorArea}>{errorMessage}</FieldError>
      <ComboBox.Popover>
        <ListBox
          renderEmptyState={() => <EmptyState>{isLoading ? t('searching') : t('msg_no_matching_tickets')}</EmptyState>}
        >
          {(option: TicketSelectOption) => (
            <ListBox.Item id={option.id} textValue={option.displayId} className='min-h-min py-1'>
              <span className='flex min-w-0 items-center gap-2'>
                <TicketIdText displayId={option.displayId} className='shrink-0' />
                <span className='min-w-0 truncate text-sm'>{option.title}</span>
                <StatusChip value={option.status} />
              </span>
            </ListBox.Item>
          )}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  )
}
