'use client'

import { DashboardLayoutEditor } from '@/components/dashboard/layout-editor'
import { WidgetDefaultLayout } from '@/components/dashboard/widget-define'
import { MultiButton } from '@/components/general/button'
import { ModalBaseProps } from '@/components/general/modal'
import { CheckIcon, Squares2X2Icon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { DashboardLayout } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { Modal } from '@heroui/react'
import { FC, useEffect, useState } from 'react'
import { getDefaultDashboard, updateDefaultDashboard } from './server'

/**
 * デフォルトレイアウト編集モーダルの本体(レイアウト取得後にマウントされる)
 */
const DefaultLayoutEditBody: FC<{ initialLayout: DashboardLayout; onSaved: () => void }> = ({
  initialLayout,
  onSaved,
}) => {
  const { t } = useLocale()
  const [layout, setLayout] = useState(initialLayout)
  const [isSaving, setSaving] = useState(false)

  return (
    <>
      <Modal.Body className='bg-background rounded-2xl pt-2'>
        <DashboardLayoutEditor layout={layout} setLayout={setLayout} editable />
      </Modal.Body>
      <Modal.Footer>
        <MultiButton slot='close' variant='ghost'>
          {t('cancel')}
        </MultiButton>
        <MultiButton
          icon={<CheckIcon />}
          isPending={isSaving}
          onPress={async () => {
            setSaving(true)
            try {
              await parseAction(updateDefaultDashboard({ layout }))
              onSaved()
            } finally {
              setSaving(false)
            }
          }}
        >
          {t('save')}
        </MultiButton>
      </Modal.Footer>
    </>
  )
}

/**
 * デフォルトレイアウト編集ポップアップ
 */
export const DefaultLayoutEditModal: FC<ModalBaseProps> = ({ state }) => {
  const { t } = useLocale()
  const [layout, setLayout] = useState<DashboardLayout>()

  useEffect(() => {
    parseAction(getDefaultDashboard()).then((res) => setLayout(res ?? WidgetDefaultLayout))
  }, [])

  return (
    <Modal.Backdrop variant='blur' isOpen={state.isOpen} onOpenChange={state.setOpen} isDismissable={false}>
      <Modal.Container placement='top'>
        <Modal.Dialog className='max-w-3xl'>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className='flex items-center gap-2'>
              <Squares2X2Icon />
              {t('default_layout_manage')}
            </Modal.Heading>
          </Modal.Header>
          {layout && (
            <DefaultLayoutEditBody
              initialLayout={layout}
              onSaved={() => {
                notify.success(t('msg_saved'))
                state.close()
              }}
            />
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
