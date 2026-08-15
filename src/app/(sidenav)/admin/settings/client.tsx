'use client'

import { AccordionSection } from '@/components/general/accordion'
import { FlexCol } from '@/components/general/flex'
import { ContentHeader } from '@/components/header'
import { Cog6ToothIcon, GoogleIcon, SlackIcon } from '@/components/icon'
import { useActionData } from '@/lib/action-client'
import { useLocale } from '@/locale/client'
import { Accordion, Skeleton } from '@heroui/react'
import { FC } from 'react'
import { GoogleAccountSettings } from './google-account'
import { getIntegrationSettingsAction } from './server'
import { SlackSettings } from './slack'

const defaultExpandedKeys = new Set(['google_account', 'slack'])
export const AdminSettingsClient: FC = () => {
  const { t } = useLocale()
  // グループ一覧は連携をまたいで共通なので、取得はこの 1 箇所にまとめる
  const { data } = useActionData(getIntegrationSettingsAction)

  return (
    <FlexCol>
      <ContentHeader icon={<Cog6ToothIcon />} title={t('integration_settings')} />
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='google_account' icon={<GoogleIcon />} title={t('google_account')}>
          {data ? <GoogleAccountSettings data={data} /> : <Skeleton className='min-h-24 w-full rounded-xl' />}
        </AccordionSection>
        <AccordionSection id='slack' icon={<SlackIcon />} title={t('slack')}>
          {data ? <SlackSettings data={data} /> : <Skeleton className='min-h-24 w-full rounded-xl' />}
        </AccordionSection>
      </Accordion>
    </FlexCol>
  )
}
