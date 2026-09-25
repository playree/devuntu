'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { DialogModal, ModalBaseProps, useModalState } from '@/components/general/modal'
import { PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { PencilSquareIcon } from '@/components/icon'
import { MarkdownInput } from '@/components/markdown/markdown-editor'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { FC, useCallback, useEffect, useState } from 'react'
import { getAnnouncement, updateAnnouncement } from './server'

/**
 * お知らせ編集ポップアップ
 */
export const AnnouncementEditModal: FC<ModalBaseProps> = ({ state, reload }) => {
  const { t } = useLocale()
  // 読み込み前は undefined。エディタは初回マウント時の値しか見ないので、読み込み後にマウントする
  const [initialBody, setInitialBody] = useState<string>()
  const [body, setBody] = useState('')
  const [isSaving, setSaving] = useState(false)

  useEffect(() => {
    parseAction(getAnnouncement()).then((res) => {
      const loaded = res?.body ?? ''
      setInitialBody(loaded)
      setBody(loaded)
    })
  }, [])

  return (
    <DialogModal
      isPending={isSaving}
      state={state}
      size='3xl'
      title={{ text: t('announcement_edit'), icon: <PencilSquareIcon /> }}
      submit={
        initialBody !== undefined
          ? {
              label: t('save'),
              isPending: isSaving,
              onPress: async () => {
                setSaving(true)
                try {
                  await parseAction(updateAnnouncement({ body }))
                  notify.success(t('msg_saved'))
                  reload()
                  state.close()
                } finally {
                  setSaving(false)
                }
              },
            }
          : undefined
      }
    >
      {initialBody !== undefined && (
        <MarkdownInput // WYSIWYG なので別途プレビューは持たない
          label={t('announcement')}
          defaultValue={initialBody}
          onChange={setBody}
          length={body.length}
        />
      )}
    </DialogModal>
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
        <MultiButton isIconOnly tooltip={t('update')} icon={<PencilSquareIcon />} onPress={() => modalState.open()} />
      </ContentHeader>

      {body !== undefined ? (
        <fieldset className='min-h-24 rounded-xl border-2 p-2'>
          <legend className='px-2 text-sm text-gray-500'>{t('announcement')}</legend>
          <MarkdownView body={body} />
        </fieldset>
      ) : (
        <PanelSkeleton className='min-h-24' />
      )}

      <AnnouncementEditModal state={modalState} key={modalState.key} reload={load} />
    </FlexCol>
  )
}
