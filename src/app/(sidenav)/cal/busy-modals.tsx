'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxField } from '@/components/general/checkbox'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { SingleSelectField } from '@/components/general/select'
import { CheckIcon, PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { minToHHmm, WEEKDAY_LABELS, WEEKDAY_ORDER } from '@/lib/day'
import { CreateBusyTime, scBusyTimeBase, scCreateBusyTime, UpdateBusyTime } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { CheckboxGroup, ErrorMessage, Label } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { createBusyTime, updateBusyTime } from './server'

const EVERYDAY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS_ONLY = [1, 2, 3, 4, 5]

/** 30分刻みの選択肢(分) */
const toTimeOptions = (mins: number[]) => Object.fromEntries(mins.map((m) => [String(m), minToHHmm(m)]))
const START_OPTIONS = toTimeOptions(Array.from({ length: 48 }, (_, i) => i * 30)) // 00:00..23:30
const END_OPTIONS = toTimeOptions(Array.from({ length: 48 }, (_, i) => (i + 1) * 30)) // 00:30..24:00

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
            <CheckboxGroup
              /**
               * ErrorMessage は react-aria のフィールドが提供する errorMessage slot が要るため
               * 素の div ではなく CheckboxGroup で囲む。
               * isRequired は渡さない(ネイティブ required 検証で submit が握り潰されるため)
               */
              className='col-span-12 gap-2'
              isInvalid={!!errors.weekdays}
              value={value.map(String)}
              onChange={(keys) => onChange(keys.map(Number))}
            >
              <div className='flex items-center gap-2'>
                <Label isRequired>{t('weekday')}</Label>
                <MultiButton size='sm' variant='outline' onPress={() => onChange(EVERYDAY)}>
                  {t('everyday')}
                </MultiButton>
                <MultiButton size='sm' variant='outline' onPress={() => onChange(WEEKDAYS_ONLY)}>
                  {t('weekdays_only')}
                </MultiButton>
              </div>
              <div // checkbox-group の既定は縦並び前提で子に mt-4 が入るため、横並び用に打ち消す
                className='flex flex-wrap gap-3 **:data-[slot=checkbox]:mt-0'
              >
                {WEEKDAY_ORDER.map((d) => (
                  <CheckBoxField key={d} id={`weekday-${d}`} value={String(d)} label={labels[d]} />
                ))}
              </div>
              <ErrorMessage className='min-h-4'>{fet(errors.weekdays)}</ErrorMessage>
            </CheckboxGroup>
          )}
        />

        {/* 開始時刻 */}
        <div className='col-span-6'>
          <Controller
            control={control}
            name='startMin'
            render={({ field: { value, onChange, onBlur, ref } }) => (
              <SingleSelectField
                groupOptions={START_OPTIONS}
                label={t('start_time')}
                isRequired
                errorMessage={fet(errors.startMin)}
                value={String(value)}
                onChange={(key) => {
                  if (key !== null) {
                    onChange(Number(key))
                  }
                }}
                onBlur={onBlur}
                ref={ref}
              />
            )}
          />
        </div>

        {/* 終了時刻 */}
        <div className='col-span-6'>
          <Controller
            control={control}
            name='endMin'
            render={({ field: { value, onChange, onBlur, ref } }) => (
              <SingleSelectField
                groupOptions={END_OPTIONS}
                label={t('end_time')}
                isRequired
                errorMessage={fet(errors.endMin)}
                value={String(value)}
                onChange={(key) => {
                  if (key !== null) {
                    onChange(Number(key))
                  }
                }}
                onBlur={onBlur}
                ref={ref}
              />
            )}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}
