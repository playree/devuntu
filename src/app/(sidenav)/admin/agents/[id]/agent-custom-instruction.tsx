'use client'

import { MultiButton } from '@/components/general/button'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { MarkdownField } from '@/components/markdown/markdown-editor'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { scSaveAgentRunnerRule } from '@/lib/schema/schema'
import { getFieldConstraints } from '@/lib/schema/schema-util'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { GetAgentRunnerReturnType, saveAgentRunnerRule } from './server'

const MAX_RULE_LENGTH = getFieldConstraints(scSaveAgentRunnerRule, 'rule').maxLength

/**
 * カスタム指示(自動運用が作業全体を通じて従うルール)。
 *
 * チケット本文と同じ View⇄編集の切り替え(`MarkdownField`)で表示する。
 * 自動運用の設定行が無い状態でも保存できるよう、専用の Server Action(`saveAgentRunnerRule`)
 * で単独保存する(自動運用フォームの他項目とは無関係に更新できる)。
 */
const CustomInstructionForm: FC<{ agentId: string; current: GetAgentRunnerReturnType; refresh: () => void }> = ({
  agentId,
  current,
  refresh,
}) => {
  const { t } = useLocale()
  const [isEditing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [isSaving, setSaving] = useState(false)

  const rule = current?.rule ?? ''
  const isSubmittable = MAX_RULE_LENGTH === undefined || draft.length <= MAX_RULE_LENGTH

  const save = async () => {
    setSaving(true)
    try {
      await parseAction(saveAgentRunnerRule({ userId: agentId, rule: draft }))
      notify.success(t('msg_saved'))
      refresh()
      setEditing(false)
    } catch {
      // エラー表示は parseAction 側で済んでいる。編集中の内容を失わせないため編集状態は維持する
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='space-y-2'>
      <NoticePanel className='text-xs'>{t('msg_agent_custom_instruction_desc')}</NoticePanel>
      <MarkdownField
        body={rule || t('msg_agent_rule_none')}
        isEditing={isEditing}
        defaultValue={rule}
        onChange={setDraft}
        length={draft.length}
        maxLength={MAX_RULE_LENGTH}
        label={t('agent_rule')}
        minRows={4}
        action={
          !isEditing && (
            <MultiButton
              isIconOnly
              size='sm'
              variant='outline'
              tooltip={t('update')}
              onPress={() => {
                setDraft(rule)
                setEditing(true)
              }}
            >
              <PencilSquareIcon width={16} />
            </MultiButton>
          )
        }
        footer={
          isEditing && (
            <>
              <MultiButton variant='ghost' size='sm' isDisabled={isSaving} onPress={() => setEditing(false)}>
                {t('cancel')}
              </MultiButton>
              <MultiButton
                size='sm'
                icon={<CheckIcon width={16} />}
                isPending={isSaving}
                isDisabled={!isSubmittable}
                onPress={save}
              >
                {t('save')}
              </MultiButton>
            </>
          )
        }
      />
    </div>
  )
}

export const AgentCustomInstruction: FC<{
  agentId: string
  current: GetAgentRunnerReturnType
  isLoading: boolean
  refresh: () => void
}> = ({ agentId, current, isLoading, refresh }) => {
  if (isLoading) {
    return <PanelSkeleton />
  }
  return <CustomInstructionForm agentId={agentId} current={current} refresh={refresh} />
}
