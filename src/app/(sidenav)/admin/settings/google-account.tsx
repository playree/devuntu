'use client'

import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { IntegrationSettingsForm } from './integration-form'
import { GetIntegrationSettingsReturnType, updateGoogleAccountSettingsAction } from './server'

export const GoogleAccountSettings: FC<{
  data: NonNullable<GetIntegrationSettingsReturnType>
}> = ({ data }) => {
  const { t } = useLocale()

  return (
    <IntegrationSettingsForm
      id='google_account_enabled'
      initial={data.google}
      groupOptions={data.groupOptions}
      enableLabel={t('google_account_enable')}
      enableDescription={t('msg_google_account_enable_desc')}
      groupsLabel={t('google_account_allowed_groups')}
      groupsDescription={t('msg_google_account_allowed_groups_desc')}
      onSave={updateGoogleAccountSettingsAction}
    />
  )
}
