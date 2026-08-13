'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { NoticePanel } from '@/components/general/panel'
import { MultiSelectCtrl } from '@/components/general/select'
import { SwitchCtrl } from '@/components/general/switch'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action-client'
import { scUpdateSlackSettings, UpdateSlackSettings } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { Skeleton } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { getSlackSettingsAction, GetSlackSettingsReturnType, updateSlackSettingsAction } from './server'

/**
 * Slack 連携設定フォーム(設定取得後にマウントされる)
 */
const SlackSettingsForm: FC<{
  initial: UpdateSlackSettings
  groupOptions: Record<string, string>
}> = ({ initial, groupOptions }) => {
  const { t } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<UpdateSlackSettings>({
    resolver: zodResolver(scUpdateSlackSettings),
    mode: 'onChange',
    defaultValues: initial,
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(updateSlackSettingsAction(req))
        notify.success(t('msg_saved'))
      })}
    >
      <GridBox isSmart>
        <div className='col-span-12 pb-2'>
          <SwitchCtrl control={control} name='enabled' id='slack_enabled' label={t('slack_enable')} />
          <p className='mt-1 text-sm text-neutral-500'>{t('msg_slack_enable_desc')}</p>
        </div>
        <div className='col-span-12'>
          <MultiSelectCtrl
            control={control}
            name='allowedGroupIds'
            groupOptions={groupOptions}
            label={t('slack_allowed_groups')}
          />
          <p className='mt-1 text-sm text-neutral-500'>{t('msg_slack_allowed_groups_desc')}</p>
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

/** Bot の接続状態。トークンの設定ミスをこの画面だけで気付けるようにする */
const SlackWorkspaceInfo: FC<{ data: NonNullable<GetSlackSettingsReturnType> }> = ({ data }) => {
  const { t } = useLocale()

  if (!data.workspace) {
    return <NoticePanel>{t('msg_slack_bot_unavailable')}</NoticePanel>
  }
  return (
    <p className='text-sm'>
      <span className='font-bold'>{t('slack_workspace')}</span>
      {` : ${data.workspace.team} (${data.workspace.teamId})`}
    </p>
  )
}

export const SlackSettings: FC = () => {
  const { data } = useActionData(getSlackSettingsAction)

  if (!data) {
    return <Skeleton className='min-h-24 w-full rounded-xl' />
  }
  return (
    <div className='flex flex-col gap-3'>
      <SlackWorkspaceInfo data={data} />
      <SlackSettingsForm
        initial={{ enabled: data.enabled, allowedGroupIds: data.allowedGroupIds }}
        groupOptions={data.groupOptions}
      />
    </div>
  )
}
