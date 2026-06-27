'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { ContentHeader } from '@/components/header'
import { PencilSquareIcon, PuzzlePieceIcon, Squares2X2Icon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { FC } from 'react'
import { DefaultLayoutEditModal } from './default-layout-edit'
import { LinkWidgetManage } from './link-widget-manage'

const defaultExpandedKeys = new Set(['link_widget_manage'])
export const AdminDashboardClient: FC = () => {
  const { t } = useLocale()
  const editModalState = useModalState()

  return (
    <FlexCol>
      <ContentHeader icon={<Squares2X2Icon />} title={t('dashboard_manage')} />
      <MultiButton
        size='sm'
        className='ml-4'
        variant='tertiary'
        icon={<PencilSquareIcon />}
        onPress={() => editModalState.open()}
      >
        {t('default_layout_manage')}
      </MultiButton>
      <DefaultLayoutEditModal state={editModalState} key={editModalState.key} reload={() => {}} />
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <Accordion.Item id='link_widget_manage'>
          <Accordion.Heading>
            <Accordion.Trigger className='gap-1'>
              <PuzzlePieceIcon />
              {t('link_widget_manage')}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className='px-4'>
              <LinkWidgetManage />
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </FlexCol>
  )
}
