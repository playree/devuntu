'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { ContentHeader } from '@/components/header'
import { MegaphoneIcon, PencilSquareIcon, PuzzlePieceIcon, Squares2X2Icon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { FC } from 'react'
import { AnnouncementManage } from './announcement-edit'
import { DefaultLayoutEditModal } from './default-layout-edit'
import { LinkWidgetManage } from './link-widget-manage'

const defaultExpandedKeys = new Set(['announcement_manage', 'link_widget_manage'])
export const AdminDashboardClient: FC = () => {
  const { t } = useLocale()
  const editModalState = useModalState()

  return (
    <FlexCol>
      <ContentHeader icon={<Squares2X2Icon />} title={t('dashboard_manage')} />
      <div className='ml-4 flex flex-wrap gap-2'>
        <MultiButton size='sm' variant='outline' icon={<PencilSquareIcon />} onPress={() => editModalState.open()}>
          {t('default_layout_manage')}
        </MultiButton>
      </div>
      <DefaultLayoutEditModal state={editModalState} key={editModalState.key} reload={() => {}} />
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='announcement_manage' icon={<MegaphoneIcon />} title={t('announcement_manage')}>
          <AnnouncementManage />
        </AccordionSection>
        <AccordionSection id='link_widget_manage' icon={<PuzzlePieceIcon />} title={t('link_widget_manage')}>
          <LinkWidgetManage />
        </AccordionSection>
      </Accordion>
    </FlexCol>
  )
}
