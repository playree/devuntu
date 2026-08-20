'use client'

import { AccordionSection } from '@/components/general/accordion'
import { FlexCol } from '@/components/general/flex'
import { ContentHeader } from '@/components/header'
import { ServerStackIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { FC } from 'react'
import { DynamicOidcClients } from './dynamic-clients'
import { ManualOidcClients } from './manual-clients'

const defaultExpandedKeys = new Set(['manual', 'dynamic'])

export const AdminOidcListClient: FC<{ baseUrl: string }> = ({ baseUrl }) => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <ContentHeader icon={<ServerStackIcon />} title={t('oidc_clients')} />
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='manual' title={t('oidc_clients_manual')}>
          <ManualOidcClients baseUrl={baseUrl} />
        </AccordionSection>
        <AccordionSection id='dynamic' title={t('oidc_clients_dynamic')}>
          <DynamicOidcClients />
        </AccordionSection>
      </Accordion>
    </FlexCol>
  )
}
