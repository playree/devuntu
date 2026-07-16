'use client'

import { Label, ListBox, Select } from '@heroui/react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

export const MultiSelectCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
}: {
  control: Control<TFieldValues>
  name: TName
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <div className='space-y-4'>
          <Select
            className='w-[256px]'
            placeholder='Select states'
            selectionMode='multiple'
            value={value}
            onChange={(keys) => onChange(keys)}
            onBlur={onBlur}
            ref={ref}
          >
            <Label>States (controlled multiple)</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox selectionMode='multiple'>
                <ListBox.Item id='california' textValue='California'>
                  California
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id='texas' textValue='Texas'>
                  Texas
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id='florida' textValue='Florida'>
                  Florida
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id='new-york' textValue='New York'>
                  New York
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id='illinois' textValue='Illinois'>
                  Illinois
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id='pennsylvania' textValue='Pennsylvania'>
                  Pennsylvania
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <p className='text-muted text-sm'>Selected: {value.length > 0 ? value.join(', ') : 'None'}</p>
        </div>
      )}
    />
  )
}
