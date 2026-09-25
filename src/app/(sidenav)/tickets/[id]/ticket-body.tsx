'use client'

import { MultiButton, SubmitButtons } from '@/components/general/button'
import { getFieldConstraints } from '@/components/general/field-constraints'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { MarkdownField } from '@/components/markdown/markdown-editor'
import { notify } from '@/components/notify'
import { MentionChips } from '@/components/ticket/mention-chips'
import { parseAction } from '@/lib/action/action-client'
import { scPatchTicket } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { type BoardAssignee } from '../use-ticket-form'
import { GetTicketReturnType, patchTicket } from './server'

/** 内容の文字数上限(MDXEditor には maxLength 属性が無いのでスキーマから取る) */
const MAX_CONTENT_LENGTH = getFieldConstraints(scPatchTicket, 'content').maxLength

type Ticket = NonNullable<GetTicketReturnType>

/** 詳細画面の本文。表示と編集を切り替え、保存したらサーバー値を取り直す */
export const TicketBody: FC<{
  ticket: Ticket
  /** メンション候補(担当者候補と同じボードメンバー) */
  boardAssignees: BoardAssignee[]
  refresh: () => Promise<void>
}> = ({ ticket, boardAssignees, refresh }) => {
  const { t } = useLocale()
  const [isEditingContent, setEditingContent] = useState(false)
  const [contentDraft, setContentDraft] = useState('')
  const [isSavingContent, setSavingContent] = useState(false)

  const saveContent = async () => {
    setSavingContent(true)
    try {
      await parseAction(patchTicket({ id: ticket.id, content: contentDraft }))
      notify.success(t('msg_saved'))
      // 表示モードへ戻すのはサーバー値が届いた後。先に戻すと旧本文が一瞬見える
      await refresh()
      setEditingContent(false)
    } catch {
      // エラー表示は parseAction 側で済んでいる。編集中の本文を失わせないため編集状態は維持する
    } finally {
      setSavingContent(false)
    }
  }

  const canEdit = ticket.canEdit
  const isContentSubmittable = MAX_CONTENT_LENGTH === undefined || contentDraft.length <= MAX_CONTENT_LENGTH

  return (
    <div className='py-4'>
      <MarkdownField
        body={ticket.content ?? ''}
        isEditing={isEditingContent}
        // 編集中に変わらない値を渡す(MDXEditor は編集モードのマウント時にこの値を取り込む)
        defaultValue={ticket.content ?? ''}
        onChange={setContentDraft}
        length={contentDraft.length}
        maxLength={MAX_CONTENT_LENGTH}
        label={t('content')}
        uploadBoardId={ticket.boardId}
        // メンション候補は担当者候補と同じボードメンバー(取得を 1 本にまとめている)
        mentionCandidates={boardAssignees}
        // ツールバー + 2 行が MarkdownField の最小高に収まるので、短い本文でも高さが動かない
        minRows={2}
        action={
          !isEditingContent &&
          canEdit && (
            <MultiButton
              isIconOnly
              size='sm'
              variant='outline'
              tooltip={t('update')}
              icon={<PencilSquareIcon width={16} />}
              onPress={() => {
                setContentDraft(ticket.content ?? '')
                setEditingContent(true)
              }}
            />
          )
        }
        footer={
          isEditingContent && (
            <SubmitButtons
              size='sm'
              label={t('save')}
              icon={<CheckIcon width={16} />}
              isPending={isSavingContent}
              isDisabled={!isContentSubmittable}
              onPress={saveContent}
              onCancel={() => setEditingContent(false)}
            />
          )
        }
      />
      {/* 誰へ届いたのかは本文の外に出す(本文中の @名前 は素のテキストのまま) */}
      {!isEditingContent && <MentionChips names={ticket.mentionedNames} className='mt-1' />}
    </div>
  )
}
