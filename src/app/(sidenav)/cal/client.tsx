'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CalendarDaysIcon, GoogleIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { useLocale } from '@/locale/client'
import { Card } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'
import {
  disableCalendarShare,
  enableCalendarShare,
  getCalendarShare,
  GetCalendarShareReturnType,
  rotateCalendarShareUrl,
} from './server'

export const CalClient: FC<{ origin: string }> = ({ origin }) => {
  const { t } = useLocale()
  const router = useRouter()
  const { confirmModal } = useConfirmModal()
  const [status, setStatus] = useState<GetCalendarShareReturnType>()

  const reload = () => {
    parseAction(getCalendarShare()).then((res) => setStatus(res))
  }

  useEffect(() => {
    reload()
  }, [])

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
      <ContentHeader icon={<CalendarDaysIcon />} title={t('calendar_share')} />
      <Card>
        <Card.Content className='flex flex-col gap-4 p-4'>
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
                  <CopyableField label={t('share_url')} text={shareUrl} variant='secondary' />
                  <div className='flex flex-wrap gap-2'>
                    <MultiButton icon={<ArrowPathIcon />} variant='outline' onPress={rotate}>
                      {t('regenerate_url')}
                    </MultiButton>
                    <MultiButton variant='outline' onPress={disable}>
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
        </Card.Content>
      </Card>
    </FlexCol>
  )
}
