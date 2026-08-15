'use client'

import { NoticePanel } from '@/components/general/panel'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { IntegrationSettingsForm } from './integration-form'
import { GetIntegrationSettingsReturnType, updateSlackSettingsAction } from './server'

type SlackData = NonNullable<GetIntegrationSettingsReturnType>['slack']

/** Bot の接続状態。トークンの設定ミスをこの画面だけで気付けるようにする */
const SlackWorkspaceInfo: FC<{ workspace: SlackData['workspace'] }> = ({ workspace }) => {
  const { t } = useLocale()

  if (!workspace) {
    return <NoticePanel>{t('msg_slack_bot_unavailable')}</NoticePanel>
  }
  return (
    <p className='text-sm'>
      <span className='font-bold'>{t('slack_workspace')}</span>
      {` : ${workspace.team} (${workspace.teamId})`}
    </p>
  )
}

export const SlackSettings: FC<{
  data: NonNullable<GetIntegrationSettingsReturnType>
}> = ({ data }) => {
  const { t } = useLocale()

  return (
    <div className='flex flex-col gap-3'>
      <SlackWorkspaceInfo workspace={data.slack.workspace} />
      <IntegrationSettingsForm
        id='slack_enabled'
        initial={{ enabled: data.slack.enabled, allowedGroupIds: data.slack.allowedGroupIds }}
        groupOptions={data.groupOptions}
        enableLabel={t('slack_enable')}
        enableDescription={t('msg_slack_enable_desc')}
        groupsLabel={t('slack_allowed_groups')}
        groupsDescription={t('msg_slack_allowed_groups_desc')}
        onSave={updateSlackSettingsAction}
      />
    </div>
  )
}
