'use client'

import { MultiButton, SubmitButtons } from '@/components/general/button'
import { getFieldConstraints } from '@/components/general/field-constraints'
import { NoticePanel } from '@/components/general/panel'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { MarkdownField } from '@/components/markdown/markdown-editor'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { scSetBoardAiContext } from '@/lib/schema/schema-board'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { setBoardAiContext } from './server'

const MAX_AI_CONTEXT_LENGTH = getFieldConstraints(scSetBoardAiContext, 'aiContext').maxLength

/**
 * ボードの AI 向けコンテキスト。閲覧はメンバー全員、編集は owner と管理者(`canManage`)。
 * チケット本文と同じ View⇄編集の切り替え(`MarkdownField`)で表示する。
 */
export const BoardAiContext: FC<{
  boardId: string
  aiContext: string
  canManage: boolean
  reload: () => void
}> = ({ boardId, aiContext, canManage, reload }) => {
  const { t } = useLocale()
  const [isEditing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [isSaving, setSaving] = useState(false)

  const isSubmittable = MAX_AI_CONTEXT_LENGTH === undefined || draft.length <= MAX_AI_CONTEXT_LENGTH

  const save = async () => {
    setSaving(true)
    try {
      await parseAction(setBoardAiContext({ id: boardId, aiContext: draft }))
      notify.success(t('msg_saved'))
      reload()
      setEditing(false)
    } catch {
      // エラー表示は parseAction 側で済んでいる。編集中の内容を失わせないため編集状態は維持する
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='space-y-2'>
      <NoticePanel className='text-xs'>{t('msg_board_ai_context_desc')}</NoticePanel>
      <MarkdownField
        body={aiContext || t('msg_board_ai_context_none')}
        isEditing={isEditing}
        defaultValue={aiContext}
        onChange={setDraft}
        length={draft.length}
        maxLength={MAX_AI_CONTEXT_LENGTH}
        label={t('board_ai_context')}
        minRows={4}
        action={
          canManage &&
          !isEditing && (
            <MultiButton
              isIconOnly
              size='sm'
              variant='outline'
              tooltip={t('update')}
              icon={<PencilSquareIcon width={16} />}
              onPress={() => {
                setDraft(aiContext)
                setEditing(true)
              }}
            />
          )
        }
        footer={
          isEditing && (
            <SubmitButtons
              size='sm'
              label={t('save')}
              icon={<CheckIcon width={16} />}
              isPending={isSaving}
              isDisabled={!isSubmittable}
              onPress={save}
              onCancel={() => setEditing(false)}
            />
          )
        }
      />
    </div>
  )
}
