'use client'

import { FlexCol } from '@/components/general/flex'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectField } from '@/components/general/select'
import { SwitchField } from '@/components/general/switch'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { AUTO_REVISE_LIMIT_MAX, AUTO_REVISE_LIMIT_MIN } from '@/lib/agent/agent'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { getBoardAgentAutoRevise, setBoardAgentAutoRevise } from './server'

const LIMIT_OPTIONS = Object.fromEntries(
  Array.from({ length: AUTO_REVISE_LIMIT_MAX - AUTO_REVISE_LIMIT_MIN + 1 }, (_, i) => {
    const value = String(AUTO_REVISE_LIMIT_MIN + i)
    return [value, value]
  }),
)

/**
 * CI の失敗・レビュー指摘による、エージェントへの自動差し戻しの設定。GitHub / GitLab で共通。
 */
export const BoardAutoRevise: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const { data, isLoading, refresh } = useActionData(() => getBoardAgentAutoRevise({ id: boardId }))
  const [isSaving, setSaving] = useState(false)

  if (isLoading) {
    return <PanelSkeleton />
  }
  if (!data) {
    return null
  }

  const save = async (next: { enabled: boolean; limit: number }) => {
    setSaving(true)
    try {
      await parseAction(setBoardAgentAutoRevise({ id: boardId, ...next }))
      notify.success(t('msg_saved'))
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setSaving(false)
    }
  }

  return (
    <FlexCol>
      <span className='text-muted text-xs'>{t('msg_agent_auto_revise_desc')}</span>
      <SwitchField
        id='agent-auto-revise'
        isSmart
        label={t('agent_auto_revise')}
        isSelected={data.enabled}
        isDisabled={isSaving}
        onChange={(enabled) => void save({ ...data, enabled })}
      />
      <div className='w-full sm:w-60'>
        <SingleSelectField
          isSmart
          label={t('agent_auto_revise_limit')}
          groupOptions={LIMIT_OPTIONS}
          value={String(data.limit)}
          isDisabled={isSaving || !data.enabled}
          onChange={(value) => {
            if (value !== null && Number(value) !== data.limit) {
              void save({ ...data, limit: Number(value) })
            }
          }}
        />
      </div>
      <NoticePanel className='text-xs'>{t('msg_agent_auto_revise_webhook')}</NoticePanel>
    </FlexCol>
  )
}
