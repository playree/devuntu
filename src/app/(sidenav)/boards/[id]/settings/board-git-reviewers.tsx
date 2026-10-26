'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { InputField } from '@/components/general/input'
import { CheckIcon } from '@/components/icon'
import { splitGitlabUsernames } from '@/lib/gitlab/gitlab'
import { zAutoReviseReviewers } from '@/lib/schema/schema-board'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'

/**
 * GitLab の MR コメントで自動差し戻しのきっかけにするユーザー名。保存後に値が変わったら作り直せるよう、
 * 呼び出し側で保存済みの値を key にする。
 */
export const GitlabAutoReviseReviewers: FC<{
  reviewers: string[]
  isDisabled: boolean
  isSaving: boolean
  onSave: (reviewers: string[]) => Promise<void>
}> = ({ reviewers, isDisabled, isSaving, onSave }) => {
  const { t } = useLocale()
  const [draft, setDraft] = useState(reviewers.join(', '))
  const parsed = zAutoReviseReviewers.safeParse(splitGitlabUsernames(draft))
  const isChanged = parsed.success && parsed.data.join(',') !== reviewers.join(',')

  return (
    <FlexCol isSmart>
      <div className='flex w-full items-end gap-2'>
        <div className='min-w-0 flex-1 sm:max-w-md'>
          <InputField
            isSmart
            label={t('agent_auto_revise_reviewers')}
            placeholder='coderabbitai, reviewer'
            autoComplete='off'
            value={draft}
            isDisabled={isDisabled || isSaving}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <MultiButton
          size='sm'
          variant='outline'
          icon={<CheckIcon width={16} />}
          isPending={isSaving}
          isDisabled={isDisabled || !isChanged}
          onPress={() => {
            if (parsed.success) {
              void onSave(parsed.data)
            }
          }}
        >
          {t('save')}
        </MultiButton>
      </div>
      {!parsed.success && (
        <span // 入力欄のエラー表示に任せると行の下端が伸びて保存ボタンがずれるので、行の外に出す
          className='text-danger text-xs'
        >
          {t('@invalid_auto_revise_reviewers')}
        </span>
      )}
      <span className='text-muted text-xs'>{t('msg_gitlab_auto_revise_reviewers_desc')}</span>
    </FlexCol>
  )
}
