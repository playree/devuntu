'use client'

import { Calendar, cn, DateField, DatePicker, DateRangePicker, ErrorMessage, Label, RangeCalendar } from '@heroui/react'
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

/**
 * DateField.Suffix 内に置くクリアボタン。
 *
 * DateField.Suffix はボタンではないので、ここは本物の button にできる
 * (Select のトリガー内にあるクリアは button の入れ子になるため span のまま)。
 */
const ClearButton = ({ onClear }: { onClear: () => void }) => (
  <button
    type='button'
    // 共通部品なのでローカライズ不要とする
    aria-label='clear'
    className='mr-1 inline-flex cursor-pointer items-center opacity-60 hover:opacity-100'
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => {
      e.stopPropagation()
      onClear()
    }}
  >
    <XCircleIcon width={16} />
  </button>
)

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
      /**
       * 既定の native はネイティブ制約検証を有効にするため、未入力だと submit イベントごと
       * 握り潰されて react-hook-form の handleSubmit まで届かない。
       * aria なら検証は zod の一本に保てる
       */
      validationBehavior='aria'
      className='flex w-full'
    >
      {label && (
        <Label
          className={cn(isSmart ? 'text-xs font-light' : '', isLabelHidden ? 'sr-only' : '')}
          isRequired={isRequired}
        >
          {label}
        </Label>
      )}
      <DateField.Group
        /**
         * isSmart: .date-input-group の h-9 固定を上書きする。
         * overflow-hidden で内側がクリップされるため Input の py も詰める
         */
        fullWidth
        variant={variant}
        className={isSmart ? 'h-7' : undefined}
      >
        <DateField.Input className={isSmart ? 'py-1' : undefined}>
          {(segment: DateSegmentValue) => <DateField.Segment segment={segment} />}
        </DateField.Input>
        <DateField.Suffix>
          {isClearable && selected && !isReadOnly && <ClearButton onClear={() => onChange(null)} />}
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

/** 日付範囲の値。両端とも `YYYY-MM-DD` で、範囲は両端を含む */
export type DateRangeValue = { start: string; end: string }

/**
 * 日付範囲(開始 - 終了)の入力。値は `DateRangeValue` または null。
 *
 * 開始・終了の両方が揃ったときだけ onChange が呼ばれる(HeroUI / react-aria の DateRangePicker は
 * 片側だけの入力を確定として通知しない)。片側だけの範囲は表せないので、解除はクリアボタンで行う。
 */
export const DateRangePickerField = ({
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
  value: DateRangeValue | null
  onChange: (value: DateRangeValue | null) => void
  onBlur?: () => void
}) => {
  const isSmart = useIsSmart(isSmartProp)
  const start = toCalendarDate(value?.start)
  const end = toCalendarDate(value?.end)
  // 片側だけでは範囲にならないので未入力扱いにする
  const selected: { start: CalendarDate; end: CalendarDate } | null = start && end ? { start, end } : null
  return (
    <DateRangePicker
      value={selected}
      // CalendarDate.toString() は YYYY-MM-DD を返す
      onChange={(range) => onChange(range ? { start: range.start.toString(), end: range.end.toString() } : null)}
      onBlur={onBlur}
      isInvalid={!!errorMessage}
      isReadOnly={isReadOnly}
      isRequired={isRequired}
      isDisabled={isDisabled}
      // validationBehavior は DatePickerField と同じ事情
      validationBehavior='aria'
      className='flex w-full'
    >
      {label && (
        <Label
          className={cn(isSmart ? 'text-xs font-light' : '', isLabelHidden ? 'sr-only' : '')}
          isRequired={isRequired}
        >
          {label}
        </Label>
      )}
      <DateField.Group // isSmart の高さ調整は DatePickerField と同じ
        fullWidth
        variant={variant}
        className={isSmart ? 'h-7' : undefined}
      >
        <DateField.Input // 範囲の両端は slot で区別する(react-aria の DateRangePicker の仕様)
          slot='start'
          className={isSmart ? 'py-1' : undefined}
        >
          {(segment: DateSegmentValue) => <DateField.Segment segment={segment} />}
        </DateField.Input>
        <DateRangePicker.RangeSeparator />
        <DateField.Input slot='end' className={isSmart ? 'py-1' : undefined}>
          {(segment: DateSegmentValue) => <DateField.Segment segment={segment} />}
        </DateField.Input>
        <DateField.Suffix>
          {isClearable && selected && !isReadOnly && <ClearButton onClear={() => onChange(null)} />}
          <DateRangePicker.Trigger>
            <DateRangePicker.TriggerIndicator />
          </DateRangePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
      <DateRangePicker.Popover>
        <RangeCalendar>
          <RangeCalendar.Header>
            <RangeCalendar.NavButton slot='previous' />
            <RangeCalendar.Heading />
            <RangeCalendar.NavButton slot='next' />
          </RangeCalendar.Header>
          <RangeCalendar.Grid>
            <RangeCalendar.GridHeader>
              {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
            </RangeCalendar.GridHeader>
            <RangeCalendar.GridBody>{(date) => <RangeCalendar.Cell date={date} />}</RangeCalendar.GridBody>
          </RangeCalendar.Grid>
        </RangeCalendar>
      </DateRangePicker.Popover>
    </DateRangePicker>
  )
}
