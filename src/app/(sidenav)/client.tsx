'use client'

import { DashboardLayoutEditor } from '@/components/dashboard/layout-editor'
import { WidgetDefaultLayout } from '@/components/dashboard/widget-define'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { DashboardLayout } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { updateDashboard } from './server'

const DragDropArea: FC<{ initialLayout: DashboardLayout }> = ({ initialLayout }) => {
  const { t } = useLocale()
  const [isEditable, setEditable] = useState(false)
  const [layout, setLayout] = useState(initialLayout)
  const [layoutBackup, setLayoutBackup] = useState<DashboardLayout>()

  return (
    <>
      <div className='flex justify-end'>
        {isEditable ? (
          <div className='flex gap-2'>
            <MultiButton
              size='sm'
              icon={<CheckIcon />}
              onPress={async () => {
                setEditable(false)
                await parseAction(updateDashboard({ layout }))
                notify.success(t('msg_saved'))
              }}
            >
              {t('save')}
            </MultiButton>
            <MultiButton
              variant='ghost'
              size='sm'
              onPress={() => {
                if (layoutBackup) {
                  setLayout(layoutBackup)
                }
                setEditable(false)
              }}
            >
              {t('cancel')}
            </MultiButton>
          </div>
        ) : (
          <MultiButton
            variant='outline'
            size='sm'
            icon={<PencilSquareIcon />}
            onPress={() => {
              setLayoutBackup(layout)
              setEditable(true)
            }}
          >
            {t('edit_dashboard')}
          </MultiButton>
        )}
      </div>

      <DashboardLayoutEditor layout={layout} setLayout={setLayout} editable={isEditable} />
    </>
  )
}

export const HomeClient: FC<{ layout: DashboardLayout | undefined | null }> = ({ layout }) => {
  return (
    <FlexCol>
      <DragDropArea initialLayout={layout ?? WidgetDefaultLayout} />
    </FlexCol>
  )
}
