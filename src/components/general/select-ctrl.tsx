'use client'

import { Chip, ErrorMessage, Label, ListBox, Select } from '@heroui/react'
import { FC, SVGProps } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { useIsSmart } from './smart'

export const XCircleIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 24 24'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z'
    />
  </svg>
)

export const MultiSelectCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  groupOptions,
  label,
  variant,
  isSmart: isSmartProp,
  errorMessage,
}: {
  control: Control<TFieldValues>
  name: TName
  groupOptions: Record<string, string>
  label: string
  variant?: 'primary' | 'secondary'
  isSmart?: boolean
  errorMessage?: string
}) => {
  const isSmart = useIsSmart(isSmartProp)
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <div className='space-y-4'>
          <Select
            selectionMode='multiple'
            value={value}
            variant={variant}
            onChange={(keys) => onChange(keys)}
            onBlur={onBlur}
            ref={ref}
          >
            <Label className={isSmart ? 'text-xs font-light' : ''}>{label}</Label>
            <Select.Trigger>
              <Select.Value>
                {() => {
                  return value.length > 0 ? (
                    value.map((id: string) => (
                      <Chip key={id} variant='soft' color='accent'>
                        {groupOptions[id]}
                      </Chip>
                    ))
                  ) : (
                    // 共通部品なのでローカライズ不要とする
                    <Chip variant='tertiary'>Not selected</Chip>
                  )
                }}
              </Select.Value>
              {value.length > 0 && (
                <span
                  role='button'
                  aria-label='clear'
                  tabIndex={-1}
                  className='ml-auto inline-flex cursor-pointer items-center opacity-60 hover:opacity-100'
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange([])
                  }}
                >
                  <XCircleIcon width={16} />
                </span>
              )}
              <Select.Indicator />
            </Select.Trigger>
            <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
            <Select.Popover>
              <ListBox selectionMode='multiple'>
                {Object.entries(groupOptions).map(([id, name]) => (
                  <ListBox.Item key={id} id={id} textValue={name}>
                    {name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      )}
    />
  )
}

/**
 * 単一選択の Select。react-hook-form の値は選択肢の ID(string) または null。
 * `isClearable` を付けると未選択(null)へ戻せる(任意入力の項目向け)。
 * `isDisabled` は値を固定して表示だけしたい場合に使う。
 */
export const SingleSelectCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  groupOptions,
  label,
  variant,
  isClearable = false,
  isDisabled = false,
  errorMessage,
  isSmart: isSmartProp,
}: {
  control: Control<TFieldValues>
  name: TName
  groupOptions: Record<string, string>
  label: string
  variant?: 'primary' | 'secondary'
  isClearable?: boolean
  isDisabled?: boolean
  errorMessage?: string
  isSmart?: boolean
}) => {
  const isSmart = useIsSmart(isSmartProp)
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <div className='space-y-4'>
          <Select
            selectionMode='single'
            value={value ?? null}
            variant={variant}
            isDisabled={isDisabled}
            onChange={(key) => onChange(key === null ? null : key.toString())}
            onBlur={onBlur}
            ref={ref}
          >
            <Label className={isSmart ? 'text-xs font-light' : ''}>{label}</Label>
            {/* isSmart: 既定 36px(min-h-9 + py-2)を 28px へ。text-sm の行高 20px + 上下 4px */}
            <Select.Trigger className={isSmart ? 'min-h-7 py-1' : undefined}>
              <Select.Value>{() => (value && groupOptions[value] ? <>{groupOptions[value]}</> : <></>)}</Select.Value>
              {isClearable && value && (
                <span
                  role='button'
                  aria-label='clear'
                  tabIndex={-1}
                  className='ml-auto inline-flex cursor-pointer items-center opacity-60 hover:opacity-100'
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(null)
                  }}
                >
                  <XCircleIcon width={16} />
                </span>
              )}
              <Select.Indicator />
            </Select.Trigger>
            <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
            <Select.Popover>
              <ListBox selectionMode='single'>
                {Object.entries(groupOptions).map(([id, name]) => (
                  <ListBox.Item key={id} id={id} textValue={name}>
                    {name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      )}
    />
  )
}
