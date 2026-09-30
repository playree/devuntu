'use client'

import { FlexCol } from '@/components/general/flex'
import { NoticePanel } from '@/components/general/panel'
import { SingleSelectField } from '@/components/general/select'
import { SwitchField } from '@/components/general/switch'
import { notify } from '@/components/notify'
import type { GitProvider } from '@/generated/prisma/enums'
import { parseAction } from '@/lib/action/action-client'
import { AUTO_REVISE_LIMIT_MAX, AUTO_REVISE_LIMIT_MIN } from '@/lib/agent/agent'
import type { BoardGitSettingValue } from '@/lib/git/git'
import { LocaleItem } from '@/locale'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { setBoardGitSetting } from './server'

const LIMIT_OPTIONS = Object.fromEntries(
  Array.from({ length: AUTO_REVISE_LIMIT_MAX - AUTO_REVISE_LIMIT_MIN + 1 }, (_, i) => {
    const value = String(AUTO_REVISE_LIMIT_MIN + i)
    return [value, value]
  }),
)

/** provider ごとに違う文言。差し戻しのきっかけになるイベントと、Webhook で追加するイベントの名前が provider で違う */
const PROVIDER_TEXTS: Record<
  GitProvider,
  { completeOnMerge: LocaleItem; autoReviseDesc: LocaleItem; autoReviseWebhook: LocaleItem }
> = {
  github: {
    completeOnMerge: 'github_complete_on_merge',
    autoReviseDesc: 'msg_github_auto_revise_desc',
    autoReviseWebhook: 'msg_github_auto_revise_webhook',
  },
  gitlab: {
    completeOnMerge: 'gitlab_complete_on_merge',
    autoReviseDesc: 'msg_gitlab_auto_revise_desc',
    autoReviseWebhook: 'msg_gitlab_auto_revise_webhook',
  },
}

/**
 * provider(GitHub / GitLab)ごとの連携の設定。マージで完了と、CI の失敗・レビュー指摘によるエージェントへの自動差し戻し。
 */
export const GitProviderSettings: FC<{
  boardId: string
  provider: GitProvider
  setting: BoardGitSettingValue
  refresh: () => Promise<void>
}> = ({ boardId, provider, setting, refresh }) => {
  const { t } = useLocale()
  const [isSaving, setSaving] = useState(false)
  const texts = PROVIDER_TEXTS[provider]

  const save = async (data: Partial<BoardGitSettingValue>) => {
    setSaving(true)
    try {
      await parseAction(setBoardGitSetting({ id: boardId, provider, ...data }))
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
      <FlexCol isSmart>
        <SwitchField
          id={`complete-on-${provider}-merge`}
          isSmart
          label={t(texts.completeOnMerge)}
          isSelected={setting.completeOnMerge}
          isDisabled={isSaving}
          onChange={(completeOnMerge) => void save({ completeOnMerge })}
        />
        <span className='text-muted text-xs'>{t('msg_git_complete_on_pr_merge')}</span>
      </FlexCol>
      <FlexCol isSmart>
        <SwitchField
          id={`${provider}-agent-auto-revise`}
          isSmart
          label={t('agent_auto_revise')}
          isSelected={setting.autoRevise}
          isDisabled={isSaving}
          onChange={(autoRevise) => void save({ autoRevise })}
        />
        <span className='text-muted text-xs'>{t(texts.autoReviseDesc)}</span>
      </FlexCol>
      <div className='w-full sm:w-60'>
        <SingleSelectField
          isSmart
          label={t('agent_auto_revise_limit')}
          groupOptions={LIMIT_OPTIONS}
          value={String(setting.autoReviseLimit)}
          isDisabled={isSaving || !setting.autoRevise}
          onChange={(value) => {
            if (value !== null && Number(value) !== setting.autoReviseLimit) {
              void save({ autoReviseLimit: Number(value) })
            }
          }}
        />
      </div>
      {setting.autoRevise && <NoticePanel className='text-xs'>{t(texts.autoReviseWebhook)}</NoticePanel>}
    </FlexCol>
  )
}
