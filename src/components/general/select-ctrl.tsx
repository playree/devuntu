'use client'

import { Chip, Label, ListBox, Select } from '@heroui/react'
import { FC, SVGProps } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

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
}: {
  control: Control<TFieldValues>
  name: TName
  groupOptions: Record<string, string>
  label: string
  variant?: 'primary' | 'secondary'
}) => {
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
            <Label>{label}</Label>
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
