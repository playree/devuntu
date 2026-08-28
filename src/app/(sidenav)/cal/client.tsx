'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CalendarDaysIcon, ClockIcon, DocumentPlusIcon, GoogleIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Accordion, Input, Label, TextField } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'
import { BusyTimeManage } from './busy-time'
import {
  disableCalendarShare,
  enableCalendarShare,
  getCalendarShare,
  rotateCalendarShareUrl,
  updateCalendarShareTitle,
} from './server'

const defaultExpandedKeys = new Set(['share', 'busy_time'])

export const CalClient: FC<{ origin: string }> = ({ origin }) => {
  const { t } = useLocale()
  const router = useRouter()
  const { confirmModal } = useConfirmModal()
  const { data: status, reload } = useActionData(getCalendarShare)
  const [title, setTitle] = useState('')
  const [syncedTitle, setSyncedTitle] = useState<string>()

  // status 取得・再取得でサーバー値が変わったら編集用 title を同期(レンダー中に調整)
  if (status && status.title !== syncedTitle) {
    setSyncedTitle(status.title)
    setTitle(status.title)
  }

  const enable = async () => {
    await parseAction(enableCalendarShare())
    notify.success(t('msg_calendar_share_enabled'))
    reload()
  }

  const disable = async () => {
    const ok = await confirmModal().confirm({
      title: t('disable_sharing'),
      text: t('msg_confirm_disable_share'),
    })
    if (ok) {
      await parseAction(disableCalendarShare())
      notify.success(t('msg_calendar_share_disabled'))
      reload()
    }
  }

  const saveTitle = async () => {
    await parseAction(updateCalendarShareTitle({ title: title.trim() }))
    notify.success(t('msg_calendar_share_title_saved'))
    reload()
  }

  const rotate = async () => {
    const ok = await confirmModal().confirm({
      title: t('regenerate_url'),
      text: t('msg_confirm_rotate_url'),
    })
    if (ok) {
      await parseAction(rotateCalendarShareUrl())
      notify.success(t('msg_calendar_share_url_rotated'))
      reload()
    }
  }

  const shareUrl = status?.publicId ? `${origin.replace(/\/$/, '')}/cal/${status.publicId}` : ''

  return (
    <FlexCol>
      <ContentHeader icon={<CalendarDaysIcon />} title={t('calendar')} />
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection
          id='share'
          icon={<ClockIcon />}
          title={t('calendar_share')}
          bodyClassName='flex flex-col gap-4'
        >
          {status && !status.googleConnected && (
            <FlexCol>
              <p className='text-sm'>{t('msg_link_google_for_calendar')}</p>
              <div>
                <MultiButton icon={<GoogleIcon />} onPress={() => router.push('/account')}>
                  {t('account')}
                </MultiButton>
              </div>
            </FlexCol>
          )}

          {status?.googleConnected && (
            <FlexCol>
              <p className='text-sm text-neutral-500'>{t('msg_calendar_share_desc')}</p>

              {status.shared ? (
                <FlexCol>
                  <div className='flex flex-wrap items-end gap-2'>
                    <TextField className='flex-auto' value={title} onChange={setTitle} maxLength={50}>
                      <Label>{t('share_title')}</Label>
                      <Input />
                    </TextField>
                    <MultiButton variant='outline' onPress={saveTitle}>
                      {t('save')}
                    </MultiButton>
                  </div>
                  <CopyableField label={t('share_url')} text={shareUrl} copyLabel={t('copy')} />
                  <div className='flex flex-wrap gap-2'>
                    <MultiButton icon={<ArrowPathIcon />} variant='outline' onPress={rotate}>
                      {t('regenerate_url')}
                    </MultiButton>
                    <MultiButton variant='danger-soft' onPress={disable}>
                      {t('disable_sharing')}
                    </MultiButton>
                  </div>
                </FlexCol>
              ) : (
                <div>
                  <MultiButton icon={<CalendarDaysIcon />} onPress={enable}>
                    {t('enable_sharing')}
                  </MultiButton>
                </div>
              )}
            </FlexCol>
          )}
        </AccordionSection>

        {status?.googleConnected && status.shared && (
          <AccordionSection id='busy_time' icon={<DocumentPlusIcon />} title={t('busy_time_manage')}>
            <BusyTimeManage />
          </AccordionSection>
        )}
      </Accordion>
    </FlexCol>
  )
}
