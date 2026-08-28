'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { ModalBaseProps, useModalState } from '@/components/general/modal'
import { ContentHeader } from '@/components/header'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { MarkdownInput } from '@/components/markdown/markdown-editor'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Modal, Skeleton } from '@heroui/react'
import { FC, useCallback, useEffect, useState } from 'react'
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
        <MarkdownInput // WYSIWYG なので別途プレビューは持たない
          label={t('announcement')}
          defaultValue={initialBody}
          onChange={setBody}
          length={body.length}
        />
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
export const AnnouncementEditModal: FC<ModalBaseProps> = ({ state, reload }) => {
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
              {t('announcement_edit')}
            </Modal.Heading>
          </Modal.Header>
          {body !== undefined && (
            <AnnouncementEditBody
              initialBody={body}
              onSaved={() => {
                notify.success(t('msg_saved'))
                reload()
                state.close()
              }}
            />
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

/**
 * お知らせ管理(プレビュー + 編集ボタン)。アコーディオン内に表示する
 */
export const AnnouncementManage: FC = () => {
  const { t } = useLocale()
  const modalState = useModalState()
  const [body, setBody] = useState<string>()

  const load = useCallback(() => {
    parseAction(getAnnouncement()).then((res) => setBody(res?.body ?? ''))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <FlexCol>
      <ContentHeader>
        <MultiButton isIconOnly tooltip={t('update')} onPress={() => modalState.open()}>
          <PencilSquareIcon />
        </MultiButton>
      </ContentHeader>

      {body !== undefined ? (
        <fieldset className='min-h-24 rounded-xl border-2 p-2'>
          <legend className='px-2 text-sm text-gray-500'>{t('announcement')}</legend>
          <MarkdownView body={body} />
        </fieldset>
      ) : (
        <Skeleton className='min-h-24 w-full rounded-xl' />
      )}

      <AnnouncementEditModal state={modalState} key={modalState.key} reload={load} />
    </FlexCol>
  )
}
