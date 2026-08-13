'use client'

import { AccordionSection } from '@/components/general/accordion'
import { FlexCol } from '@/components/general/flex'
import { ContentHeader } from '@/components/header'
import { Cog6ToothIcon, GoogleIcon, SlackIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { FC } from 'react'
import { GoogleAccountSettings } from './google-account'
import { SlackSettings } from './slack'

const defaultExpandedKeys = new Set(['google_account', 'slack'])
export const AdminSettingsClient: FC = () => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <ContentHeader icon={<Cog6ToothIcon />} title={t('integration_settings')} />
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='google_account' icon={<GoogleIcon />} title={t('google_account')}>
          <GoogleAccountSettings />
        </AccordionSection>
        <AccordionSection id='slack' icon={<SlackIcon />} title={t('slack')}>
          <SlackSettings />
        </AccordionSection>
      </Accordion>
    </FlexCol>
  )
}
