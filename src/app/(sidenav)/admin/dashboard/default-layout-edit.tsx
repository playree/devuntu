'use client'

import { DashboardLayoutEditor } from '@/components/dashboard/layout-editor'
import { WidgetDefaultLayout } from '@/components/dashboard/widget-define'
import { DialogModal, ModalBaseProps } from '@/components/general/modal'
import { Squares2X2Icon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { DashboardLayout } from '@/lib/schema/schema-dashboard'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useState } from 'react'
import { getDefaultDashboard, updateDefaultDashboard } from './server'

/**
 * デフォルトレイアウト編集ポップアップ
 */
export const DefaultLayoutEditModal: FC<ModalBaseProps> = ({ state }) => {
  const { t } = useLocale()
  const [layout, setLayout] = useState<DashboardLayout>(WidgetDefaultLayout)
  const [isLoaded, setLoaded] = useState(false)
  const [isSaving, setSaving] = useState(false)

  useEffect(() => {
    parseAction(getDefaultDashboard()).then((res) => {
      setLayout(res ?? WidgetDefaultLayout)
      setLoaded(true)
    })
  }, [])

  return (
    <DialogModal
      isPending={isSaving}
      state={state}
      size='3xl'
      title={{ text: t('default_layout_manage'), icon: <Squares2X2Icon /> }}
      bodyClassName='bg-background rounded-2xl'
      submit={
        isLoaded
          ? {
              label: t('save'),
              isPending: isSaving,
              onPress: async () => {
                setSaving(true)
                try {
                  await parseAction(updateDefaultDashboard({ layout }))
                  notify.success(t('msg_saved'))
                  state.close()
                } finally {
                  setSaving(false)
                }
              },
            }
          : undefined
      }
    >
      {isLoaded && <DashboardLayoutEditor layout={layout} setLayout={setLayout} editable />}
    </DialogModal>
  )
}
