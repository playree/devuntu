'use client'

import { Calendar, cn, DateField, DatePicker, ErrorMessage, Label } from '@heroui/react'
import { CalendarDate, parseDate } from '@internationalized/date'
import { ComponentProps } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { XCircleIcon } from './select'
import { useIsSmart } from './smart'

/** DateField.Input の children が受け取るセグメント(型を直接 import できないため props から導出する) */
type DateSegmentValue = ComponentProps<typeof DateField.Segment>['segment']

/**
 * フォームの値(`YYYY-MM-DD` 文字列)を CalendarDate へ変換する。
 * 不正な値は null(未入力扱い)にして描画を壊さない。
 */
const toCalendarDate = (value: unknown): CalendarDate | null => {
  if (typeof value !== 'string' || value === '') {
    return null
  }
  try {
    return parseDate(value)
  } catch {
    return null
  }
}

type DatePickerFieldProps = {
  label?: string
  /** ラベルを読み上げ用にだけ残す(見出しを呼び出し側で出す場合) */
  isLabelHidden?: boolean
  errorMessage?: string
  isRequired?: boolean
  isReadOnly?: boolean
  isDisabled?: boolean
  /** クリアボタンを表示する(任意入力の日付向け) */
  isClearable?: boolean
  variant?: 'primary' | 'secondary'
  isSmart?: boolean
}

/**
 * react-hook-form に依存しない DatePicker(日付のみ)本体。
 * 値は `YYYY-MM-DD` 文字列または null。CalendarDate との変換はこの中に隠蔽する。
 */
export const DatePickerField = ({
  label,
  isLabelHidden,
  errorMessage,
  isRequired,
  isReadOnly,
  isDisabled,
  isClearable = true,
  variant,
  isSmart: isSmartProp,
  value,
  onChange,
  onBlur,
}: DatePickerFieldProps & {
  value: string | null
  onChange: (value: string | null) => void
  onBlur?: () => void
}) => {
  const isSmart = useIsSmart(isSmartProp)
  const selected = toCalendarDate(value)
  return (
    <DatePicker
      value={selected}
      // CalendarDate.toString() は YYYY-MM-DD を返す
      onChange={(date) => onChange(date ? date.toString() : null)}
      onBlur={onBlur}
      isInvalid={!!errorMessage}
      isReadOnly={isReadOnly}
      isRequired={isRequired}
      isDisabled={isDisabled}
      className='flex w-full'
    >
      {label && (
        <Label className={cn(isSmart ? 'text-xs font-light' : '', isLabelHidden ? 'sr-only' : '')}>
          {label}
          {isRequired ? '*' : ''}
        </Label>
      )}
      <DateField.Group
        /**
         * isSmart: .date-input-group は h-9 固定なので h-7 で上書きし、
         * overflow-hidden で内側がクリップされないよう Input の py も詰める
         */
        fullWidth
        variant={variant}
        className={isSmart ? 'h-7' : undefined}
      >
        <DateField.Input className={isSmart ? 'py-1' : undefined}>
          {(segment: DateSegmentValue) => <DateField.Segment segment={segment} />}
        </DateField.Input>
        <DateField.Suffix>
          {isClearable && selected && !isReadOnly && (
            <button
              /**
               * DateField.Suffix はボタンではないので、ここは本物の button にできる
               * (Select のトリガー内にあるクリアは button の入れ子になるため span のまま)
               */
              type='button'
              // 共通部品なのでローカライズ不要とする
              aria-label='clear'
              className='mr-1 inline-flex cursor-pointer items-center opacity-60 hover:opacity-100'
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onChange(null)
              }}
            >
              <XCircleIcon width={16} />
            </button>
          )}
          <DatePicker.Trigger>
            <DatePicker.TriggerIndicator />
          </DatePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
      <DatePicker.Popover>
        <Calendar>
          <Calendar.Header>
            <Calendar.NavButton slot='previous' />
            <Calendar.Heading />
            <Calendar.NavButton slot='next' />
          </Calendar.Header>
          <Calendar.Grid>
            <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
            <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
          </Calendar.Grid>
        </Calendar>
      </DatePicker.Popover>
    </DatePicker>
  )
}

/**
 * react-hook-form 対応の DatePicker(日付のみ)。描画は DatePickerField に委譲する。
 * フォーム側の値は `YYYY-MM-DD` 文字列で扱う。
 */
export const DatePickerCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  ...props
}: DatePickerFieldProps & {
  control: Control<TFieldValues>
  name: TName
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur } }) => (
        <DatePickerField
          {...props}
          value={typeof value === 'string' ? value : null}
          onChange={onChange}
          onBlur={onBlur}
        />
      )}
    />
  )
}
