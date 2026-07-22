'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxCtrl } from '@/components/general/checkbox-ctrl'
import { FlexCol } from '@/components/general/flex'
import { GridBox } from '@/components/general/grid'
import { MultiSelectCtrl } from '@/components/general/select-ctrl'
import { ContentHeader } from '@/components/header'
import { CheckIcon, Cog6ToothIcon, GoogleIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { scUpdateGoogleAccountSettings, UpdateGoogleAccountSettings } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { Card, Skeleton } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { getGoogleAccountSettingsAction, updateGoogleAccountSettingsAction } from './server'

/**
 * Google アカウント連携設定フォーム(設定取得後にマウントされる)
 */
const GoogleAccountSettingsForm: FC<{
  initial: UpdateGoogleAccountSettings
  groupOptions: Record<string, string>
}> = ({ initial, groupOptions }) => {
  const { t } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<UpdateGoogleAccountSettings>({
    resolver: zodResolver(scUpdateGoogleAccountSettings),
    mode: 'onChange',
    defaultValues: initial,
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(updateGoogleAccountSettingsAction(req))
        notify.success(t('msg_saved'))
      })}
    >
      <GridBox>
        <div className='col-span-12 pb-2'>
          <CheckBoxCtrl
            control={control}
            variant='secondary'
            name='enabled'
            id='enabled'
            label={t('google_account_enable')}
          />
          <p className='mt-1 text-sm text-neutral-500'>{t('msg_google_account_enable_desc')}</p>
        </div>
        <div className='col-span-12'>
          <MultiSelectCtrl
            control={control}
            name='allowedGroupIds'
            groupOptions={groupOptions}
            label={t('google_account_allowed_groups')}
            variant='secondary'
          />
          <p className='mt-1 text-sm text-neutral-500'>{t('msg_google_account_allowed_groups_desc')}</p>
        </div>
        <div className='col-span-12 pt-2'>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </GridBox>
    </form>
  )
}

export const AdminSettingsClient: FC = () => {
  const { t } = useLocale()
  const [data, setData] = useState<{
    initial: UpdateGoogleAccountSettings
    groupOptions: Record<string, string>
  }>()

  useEffect(() => {
    parseAction(getGoogleAccountSettingsAction()).then((res) => {
      if (res) {
        setData({
          initial: { enabled: res.enabled, allowedGroupIds: res.allowedGroupIds },
          groupOptions: res.groupOptions,
        })
      }
    })
  }, [])

  return (
    <FlexCol>
      <ContentHeader icon={<Cog6ToothIcon />} title={t('integration_settings')} />
      <Card>
        <Card.Content className='flex flex-col gap-2 p-4'>
          <ContentHeader icon={<GoogleIcon />} title={t('google_account')} className='text-foreground' />
          {data ? (
            <GoogleAccountSettingsForm initial={data.initial} groupOptions={data.groupOptions} />
          ) : (
            <Skeleton className='min-h-24 w-full rounded-xl' />
          )}
        </Card.Content>
      </Card>
    </FlexCol>
  )
}
