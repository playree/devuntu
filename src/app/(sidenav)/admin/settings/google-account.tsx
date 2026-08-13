'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { MultiSelectCtrl } from '@/components/general/select'
import { SwitchCtrl } from '@/components/general/switch'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action-client'
import { scUpdateGoogleAccountSettings, UpdateGoogleAccountSettings } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { Skeleton } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
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
      <GridBox isSmart>
        <div className='col-span-12 pb-2'>
          <SwitchCtrl control={control} name='enabled' id='enabled' label={t('google_account_enable')} />
          <p className='mt-1 text-sm text-neutral-500'>{t('msg_google_account_enable_desc')}</p>
        </div>
        <div className='col-span-12'>
          <MultiSelectCtrl
            control={control}
            name='allowedGroupIds'
            groupOptions={groupOptions}
            label={t('google_account_allowed_groups')}
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

export const GoogleAccountSettings: FC = () => {
  const { data } = useActionData(getGoogleAccountSettingsAction)

  if (!data) {
    return <Skeleton className='min-h-24 w-full rounded-xl' />
  }
  return (
    <GoogleAccountSettingsForm
      initial={{ enabled: data.enabled, allowedGroupIds: data.allowedGroupIds }}
      groupOptions={data.groupOptions}
    />
  )
}
