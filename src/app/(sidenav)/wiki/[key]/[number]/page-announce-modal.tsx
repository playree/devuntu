'use client'

import { DatePickerCtrl } from '@/components/general/date-picker'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, type ModalBaseProps } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import { RadioCtrl } from '@/components/general/radio'
import { SingleSelectField } from '@/components/general/select'
import { MegaphoneIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { useWikiAnnounceKindOptions } from '@/components/wiki-chip'
import type { WikiAnnouncementNotifyKind } from '@/generated/prisma/enums'
import { parseAction } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { minToHHmm, toZone, zonedMinutes } from '@/lib/day'
import { ClientError } from '@/lib/error'
import { scWikiAnnounceForm, type WikiAnnounceForm, type WikiAnnounceFormIn } from '@/lib/schema/schema-wiki'
import { isValidWikiAnnounceSchedule, WIKI_ANNOUNCE_TIME_STEP_MIN } from '@/lib/wiki/wiki-announcement-notify-rule'
import { el } from '@/locale'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  notifyWikiAnnouncement,
  scheduleWikiAnnouncementNotify,
  updateWikiAnnouncementNotify,
  type GetWikiAnnouncementNotifiesReturnType,
} from './server'

export type WikiAnnounceItem = NonNullable<GetWikiAnnouncementNotifiesReturnType>['items'][number]

const DAY_MIN = 24 * 60

/** 予約の時刻の選択肢(分 → HH:mm) */
const TIME_OPTIONS = Object.fromEntries(
  Array.from({ length: DAY_MIN / WIKI_ANNOUNCE_TIME_STEP_MIN }, (_, i) => {
    const min = i * WIKI_ANNOUNCE_TIME_STEP_MIN
    return [String(min), minToHHmm(min)]
  }),
)

/** 利用者のタイムゾーンでの日付と 0:00 からの分。新しい予約は 1 時間後を刻みに切り上げた時刻にする */
const zonedParts = (date: Date, tz: string, roundUp: boolean) => {
  const zoned = toZone(date, tz)
  const min = zoned.hour() * 60 + zoned.minute()
  const step = WIKI_ANNOUNCE_TIME_STEP_MIN
  const rounded = roundUp ? Math.ceil(min / step) * step : Math.floor(min / step) * step
  const day = rounded >= DAY_MIN ? zoned.add(1, 'day') : zoned
  return { date: day.format('YYYY-MM-DD'), minutes: rounded % DAY_MIN }
}

/**
 * アナウンスの通知(今すぐ / 日時指定)。`target` を渡すと予約の変更になり、日時指定に固定する。
 * 送れない(通知先が未設定・Slack 連携が無効)ときは案内を出して送らせない
 */
export const WikiAnnounceModal: FC<
  ModalBaseProps & {
    pageId: string
    defaultKind: WikiAnnouncementNotifyKind
    available: boolean
    target?: WikiAnnounceItem
  }
> = ({ state, reload, pageId, defaultKind, available, target }) => {
  const { t, fet } = useLocale()
  const timezone = useUserTimezone()
  const kindOptions = useWikiAnnounceKindOptions()
  // 開いた時点の時刻から決める(モーダルは開くたびに key で作り直される)
  const [initial] = useState(() =>
    target
      ? zonedParts(target.scheduledAt, timezone, false)
      : zonedParts(new Date(Date.now() + 60 * 60 * 1000), timezone, true),
  )

  const {
    control,
    handleSubmit,
    setError,
    formState: { isSubmitting, errors },
  } = useForm<WikiAnnounceFormIn, unknown, WikiAnnounceForm>({
    resolver: zodResolver(scWikiAnnounceForm),
    mode: 'onChange',
    defaultValues: {
      kind: target?.kind ?? defaultKind,
      message: target?.message ?? '',
      timing: target ? 'schedule' : 'now',
      date: initial.date,
      minutes: initial.minutes,
    },
  })
  const timing = useWatch({ control, name: 'timing' })

  /** 送った・予約したら true。日時が範囲外なら入力欄にエラーを出して false */
  const submit = async ({ kind, message, timing, date, minutes }: WikiAnnounceForm): Promise<boolean> => {
    if (timing === 'now') {
      await parseAction(notifyWikiAnnouncement({ id: pageId, kind, message }))
      notify.success(t('msg_wiki_announce_sent'))
      return true
    }
    const scheduledAt = zonedMinutes(date, minutes, timezone).toDate()
    if (!isValidWikiAnnounceSchedule(scheduledAt, new Date())) {
      setError('date', { message: el('@invalid_wiki_announce_schedule') })
      return false
    }
    const req = { kind, message, scheduledAt: scheduledAt.toISOString() }
    if (target) {
      await parseAction(updateWikiAnnouncementNotify({ id: target.id, ...req }))
    } else {
      await parseAction(scheduleWikiAnnouncementNotify({ id: pageId, ...req }))
    }
    notify.success(t('msg_wiki_announce_scheduled'))
    return true
  }

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        try {
          if (await submit(req)) {
            reload()
            state.close()
          }
        } catch (e) {
          // parseAction が通知済み(予約が送信済みになっていた等)。履歴を取り直して、入力はそのまま残す
          if (!(e instanceof ClientError)) {
            throw e
          }
          reload()
        }
      })}
      title={{ text: target ? t('wiki_announce_edit') : t('wiki_announce'), icon: <MegaphoneIcon /> }}
      submit={{
        label: timing === 'now' ? t('wiki_announce_send') : t('wiki_announce_schedule'),
        isPending: isSubmitting,
        isDisabled: !available,
      }}
    >
      <GridBox>
        <div className='col-span-12'>
          {available ? (
            <NoticePanel className='text-xs'>{t('msg_wiki_announce_desc')}</NoticePanel>
          ) : (
            <NoticePanel className='text-xs' status='warning'>
              {t('msg_wiki_announce_unavailable')}
            </NoticePanel>
          )}
        </div>
        <RadioCtrl
          className='col-span-12'
          control={control}
          name='kind'
          label={t('wiki_announce_kind')}
          orientation='horizontal'
          options={Object.entries(kindOptions).map(([value, label]) => ({ value, label }))}
        />
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='message'
            label={t('wiki_announce_message')}
            placeholder={t('wiki_announce_message_placeholder')}
            errorMessage={fet(errors.message)}
          />
        </div>
        {!target && (
          <RadioCtrl
            className='col-span-12'
            control={control}
            name='timing'
            label={t('wiki_announce_timing')}
            orientation='horizontal'
            options={[
              { value: 'now', label: t('wiki_announce_now') },
              { value: 'schedule', label: t('wiki_announce_at') },
            ]}
          />
        )}
        {timing === 'schedule' && (
          <>
            <div className='col-span-7'>
              <DatePickerCtrl
                control={control}
                name='date'
                label={t('wiki_announce_date')}
                isRequired
                isClearable={false}
                errorMessage={fet(errors.date)}
              />
            </div>
            <div className='col-span-5'>
              <Controller
                control={control}
                name='minutes'
                render={({ field: { value, onChange, onBlur, ref } }) => (
                  <SingleSelectField
                    groupOptions={TIME_OPTIONS}
                    label={t('wiki_announce_time')}
                    isRequired
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
            <p className='text-muted col-span-12 text-xs'>{t('wiki_announce_timezone', { tz: timezone })}</p>
          </>
        )}
      </GridBox>
    </FormModal>
  )
}
