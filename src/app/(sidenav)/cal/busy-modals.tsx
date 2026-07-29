'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxItem } from '@/components/general/checkbox-ctrl'
import { FlexCol } from '@/components/general/flex'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { CheckIcon, PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { minToHHmm, WEEKDAY_LABELS, WEEKDAY_ORDER } from '@/lib/day'
import { CreateBusyTime, scBusyTimeBase, scCreateBusyTime, UpdateBusyTime } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { ErrorMessage, Label, ListBox, Select } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { createBusyTime, updateBusyTime } from './server'

const EVERYDAY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS_ONLY = [1, 2, 3, 4, 5]

/** 30分刻みの選択肢(分) */
const START_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30) // 00:00..23:30
const END_OPTIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 30) // 00:30..24:00

const toggle = (arr: number[], d: number) => (arr.includes(d) ? arr.filter((x) => x !== d) : [...arr, d])

/**
 * 追加Busy時間の登録/更新モーダル。target が渡されれば更新、無ければ新規登録。
 */
export const BusyTimeModal: FC<ModalBaseProps & { target?: UpdateBusyTime }> = ({ state, reload, target }) => {
  const { t, fet, locale } = useLocale()
  const labels = WEEKDAY_LABELS[locale] ?? WEEKDAY_LABELS.ja
  const isEdit = !!target

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateBusyTime>({
    resolver: zodResolver(scCreateBusyTime),
    mode: 'onChange',
    defaultValues: {
      title: target?.title ?? '',
      weekdays: target?.weekdays ?? [],
      startMin: target?.startMin ?? 540, // 09:00
      endMin: target?.endMin ?? 1080, // 18:00
    },
  })

  return (
    <FormModal
      size='lg'
      state={state}
      onSubmit={handleSubmit(async (req) => {
        if (target) {
          await parseAction(updateBusyTime({ id: target.id, ...req }))
          notify.success(t('msg_updated_target', { target: req.title }))
        } else {
          await parseAction(createBusyTime(req))
          notify.success(t('msg_added_target', { target: req.title }))
        }
        reload()
        state.close()
      })}
      title={{
        text: isEdit ? t('update_busy_time') : t('add_busy_time'),
        icon: isEdit ? <PencilSquareIcon /> : <PlusIcon />,
      }}
      footer={
        <>
          <MultiButton slot='close' variant='ghost'>
            {t('cancel')}
          </MultiButton>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('ok')}
          </MultiButton>
        </>
      }
    >
      <GridBox>
        {/* 件名 */}
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='title'
            constraintSchema={scBusyTimeBase}
            label={t('title')}
            errorMessage={fet(errors.title)}
            autoFocus
          />
        </div>

        {/* 曜日(チェックボックス + 一括ボタン) */}
        <Controller
          control={control}
          name='weekdays'
          render={({ field: { value, onChange } }) => (
            <FlexCol className='col-span-12 gap-2'>
              <div className='flex items-center gap-2'>
                <Label>{t('weekday')}*</Label>
                <MultiButton size='sm' variant='outline' onPress={() => onChange(EVERYDAY)}>
                  {t('everyday')}
                </MultiButton>
                <MultiButton size='sm' variant='outline' onPress={() => onChange(WEEKDAYS_ONLY)}>
                  {t('weekdays_only')}
                </MultiButton>
              </div>
              <div className='flex flex-wrap gap-3'>
                {WEEKDAY_ORDER.map((d) => (
                  <CheckBoxItem
                    key={d}
                    id={`weekday-${d}`}
                    label={labels[d]}
                    variant='secondary'
                    isSelected={value.includes(d)}
                    onChange={() => onChange(toggle(value, d))}
                  />
                ))}
              </div>
              <ErrorMessage className='min-h-4'>{fet(errors.weekdays)}</ErrorMessage>
            </FlexCol>
          )}
        />

        {/* 開始時刻 */}
        <div className='col-span-6'>
          <Controller
            control={control}
            name='startMin'
            render={({ field: { value, onChange, onBlur, ref } }) => (
              <Select
                selectionMode='single'
                variant='secondary'
                value={String(value)}
                onChange={(key) => {
                  if (key !== null) {
                    onChange(Number(key))
                  }
                }}
                onBlur={onBlur}
                ref={ref}
              >
                <Label>{t('start_time')}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox selectionMode='single'>
                    {START_OPTIONS.map((m) => (
                      <ListBox.Item key={m} id={String(m)} textValue={minToHHmm(m)}>
                        {minToHHmm(m)}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}
          />
          <ErrorMessage className='min-h-4'>{fet(errors.startMin)}</ErrorMessage>
        </div>

        {/* 終了時刻 */}
        <div className='col-span-6'>
          <Controller
            control={control}
            name='endMin'
            render={({ field: { value, onChange, onBlur, ref } }) => (
              <Select
                selectionMode='single'
                variant='secondary'
                value={String(value)}
                onChange={(key) => {
                  if (key !== null) {
                    onChange(Number(key))
                  }
                }}
                onBlur={onBlur}
                ref={ref}
              >
                <Label>{t('end_time')}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox selectionMode='single'>
                    {END_OPTIONS.map((m) => (
                      <ListBox.Item key={m} id={String(m)} textValue={minToHHmm(m)}>
                        {minToHHmm(m)}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}
          />
          <ErrorMessage className='min-h-4'>{fet(errors.endMin)}</ErrorMessage>
        </div>
      </GridBox>
    </FormModal>
  )
}
