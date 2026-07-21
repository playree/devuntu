'use client'

import { FlexCol } from '@/components/general/flex'
import { ContentHeader } from '@/components/header'
import { Cog6ToothIcon, FingerPrintIcon, GoogleIcon, UserCircleIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { FC } from 'react'
import { GoogleAccountLink } from './google-account'
import { MyPasskey } from './passkey'
import { TimezoneSetting } from './timezone'

const defaultExpandedKeys = new Set(['passkey', 'google_account', 'timezone'])
export const AccountClient: FC = () => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <ContentHeader icon={<UserCircleIcon />} title={t('account')}></ContentHeader>
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <Accordion.Item id='timezone'>
          <Accordion.Heading>
            <Accordion.Trigger className='gap-1'>
              <Cog6ToothIcon />
              {t('timezone')}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className='px-4'>
              <TimezoneSetting />
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item id='passkey'>
          <Accordion.Heading>
            <Accordion.Trigger className='gap-1'>
              <FingerPrintIcon />
              {t('passkey')}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className='px-4'>
              <MyPasskey />
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item id='google_account'>
          <Accordion.Heading>
            <Accordion.Trigger className='gap-1'>
              <GoogleIcon />
              {t('google_account')}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className='px-4'>
              <GoogleAccountLink />
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </FlexCol>
  )
}
