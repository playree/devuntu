'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { ModalBaseProps } from '@/components/general/modal'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { useLocale } from '@/locale/client'
import { Label, Modal, TextArea } from '@heroui/react'
import { FC, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getAnnouncement, updateAnnouncement } from './server'

/**
 * お知らせ編集モーダルの本体(内容取得後にマウントされる)
 */
const AnnouncementEditBody: FC<{ initialBody: string; onSaved: () => void }> = ({ initialBody, onSaved }) => {
  const { t } = useLocale()
  const [body, setBody] = useState(initialBody)
  const [isSaving, setSaving] = useState(false)

  return (
    <>
      <Modal.Body className='pt-2'>
        <FlexCol>
          <Label>{t('announcement')}</Label>
          <TextArea fullWidth rows={4} variant='secondary' value={body} onChange={(e) => setBody(e.target.value)} />
          <fieldset className='min-h-24 rounded-xl border-2 p-2'>
            <legend className='px-2 text-sm text-gray-500'>{t('preview')}</legend>
            <div className='markdown'>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </div>
          </fieldset>
        </FlexCol>
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
              await parseAction(updateAnnouncement({ body }))
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
 * お知らせ編集ポップアップ
 */
export const AnnouncementEditModal: FC<ModalBaseProps> = ({ state }) => {
  const { t } = useLocale()
  const [body, setBody] = useState<string>()

  useEffect(() => {
    parseAction(getAnnouncement()).then((res) => setBody(res?.body ?? ''))
  }, [])

  return (
    <Modal.Backdrop variant='blur' isOpen={state.isOpen} onOpenChange={state.setOpen} isDismissable={false}>
      <Modal.Container placement='top'>
        <Modal.Dialog className='max-w-3xl'>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className='flex items-center gap-2'>
              <PencilSquareIcon />
              {t('announcement_manage')}
            </Modal.Heading>
          </Modal.Header>
          {body !== undefined && (
            <AnnouncementEditBody
              initialBody={body}
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
