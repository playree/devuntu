'use client'

import { AccordionSection } from '@/components/general/accordion'
import { FlexCol } from '@/components/general/flex'
import { ContentHeader } from '@/components/header'
import { BellIcon, Cog6ToothIcon, FingerPrintIcon, GoogleIcon, SlackIcon, UserCircleIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { FC } from 'react'
import { GoogleAccountLink } from './google-account'
import { NotifySettings } from './notify'
import { MyPasskey } from './passkey'
import { SlackAccountLink } from './slack'
import { TimezoneSetting } from './timezone'

const defaultExpandedKeys = new Set(['passkey', 'google_account', 'slack', 'timezone', 'notify'])
export const AccountClient: FC<{ googleAvailable: boolean; slackAvailable: boolean }> = ({
  googleAvailable,
  slackAvailable,
}) => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <ContentHeader icon={<UserCircleIcon />} title={t('account')}></ContentHeader>
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='timezone' icon={<Cog6ToothIcon />} title={t('timezone')}>
          <TimezoneSetting />
        </AccordionSection>
        <AccordionSection id='passkey' icon={<FingerPrintIcon />} title={t('passkey')}>
          <MyPasskey />
        </AccordionSection>
        {googleAvailable && (
          <AccordionSection id='google_account' icon={<GoogleIcon />} title={t('google_account')}>
            <GoogleAccountLink />
          </AccordionSection>
        )}
        {slackAvailable && (
          <AccordionSection id='slack' icon={<SlackIcon />} title={t('slack')}>
            <SlackAccountLink />
          </AccordionSection>
        )}
        <AccordionSection // メール通知は Slack 連携の有無に関わらず設定できるので常に表示する
          id='notify'
          icon={<BellIcon />}
          title={t('notify_settings')}
        >
          <NotifySettings slackAvailable={slackAvailable} />
        </AccordionSection>
      </Accordion>
    </FlexCol>
  )
}
