'use client'

import { AccordionSection } from '@/components/general/accordion'
import { FlexCol } from '@/components/general/flex'
import { ContentHeader } from '@/components/header'
import {
  BellIcon,
  Cog6ToothIcon,
  FingerPrintIcon,
  GoogleIcon,
  KeyIcon,
  PhotoIcon,
  PuzzlePieceIcon,
  SlackIcon,
  UserCircleIcon,
} from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { FC } from 'react'
import { AvatarSetting } from './avatar'
import { GoogleAccountLink } from './google-account'
import { MyMcpTokens } from './mcp-token'
import { NotifySettings } from './notify'
import { MyOAuthConsents } from './oauth-consents'
import { MyPasskey } from './passkey'
import { SlackAccountLink } from './slack'
import { TimezoneSetting } from './timezone'

const defaultExpandedKeys = new Set(['avatar', 'passkey', 'timezone', 'notify'])
export const AccountClient: FC<{ googleAvailable: boolean; slackAvailable: boolean; baseUrl: string }> = ({
  googleAvailable,
  slackAvailable,
  baseUrl,
}) => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <ContentHeader icon={<UserCircleIcon />} title={t('account')}></ContentHeader>
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='avatar' icon={<PhotoIcon />} title={t('avatar')}>
          <AvatarSetting />
        </AccordionSection>
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
        <AccordionSection id='oauth_consents' icon={<PuzzlePieceIcon />} title={t('consent_apps')}>
          <MyOAuthConsents />
        </AccordionSection>
        <AccordionSection id='mcp_token' icon={<KeyIcon />} title={t('mcp_token')}>
          <MyMcpTokens baseUrl={baseUrl} />
        </AccordionSection>
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
