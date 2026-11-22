'use client'

import { MultiButton } from '@/components/general/button'
import { ClipboardDocumentIcon } from '@/components/general/icons'
import { DialogModal, type useModalState } from '@/components/general/modal'
import { useCopyToClipboard } from '@/components/general/use-copy-to-clipboard'
import { ArrowTopRightOnSquareIcon, CheckIcon, ExclamationTriangleIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

/** 競合したときに取り直した最新のページ。取れなかったときは undefined(上書き保存はできない) */
export type WikiPageConflictTarget = {
  latest?: { updatedAt: Date; updatedByName?: string }
}

/**
 * 保存が競合したときの選択肢。下書きは残したまま、最新の確認・下書きのコピー・上書き保存を選べる。
 * 閉じると編集に戻る
 */
export const WikiPageConflictModal: FC<{
  state: ReturnType<typeof useModalState<WikiPageConflictTarget>>
  href: string
  content: string
  isSaving: boolean
  /** 下書きを保存できる状態か(画像のアップロード中などは上書き保存もできない) */
  isSubmittable: boolean
  onOverwrite: (expectedUpdatedAt: Date) => void
}> = ({ state, href, content, isSaving, isSubmittable, onOverwrite }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { copy } = useCopyToClipboard()
  const latest = state.target?.latest

  const copyDraft = async () => {
    if (await copy(content)) {
      notify.success(t('msg_wiki_draft_copied'))
    } else {
      notify.error(t('msg_wiki_draft_copy_failed'))
    }
  }

  return (
    <DialogModal
      state={state}
      title={{ text: t('wiki_conflict_title'), icon: <ExclamationTriangleIcon className='text-warning' /> }}
      size='lg'
      isPending={isSaving}
      footer={
        <div // 収まらない幅では折り返す
          className='flex w-full flex-wrap justify-end gap-2'
        >
          <MultiButton
            variant='outline'
            icon={<ArrowTopRightOnSquareIcon width={16} />}
            isDisabled={isSaving}
            onPress={() => window.open(href, '_blank', 'noopener')}
          >
            {t('wiki_conflict_open_latest')}
          </MultiButton>
          <MultiButton
            variant='outline'
            icon={<ClipboardDocumentIcon width={16} />}
            isDisabled={isSaving}
            onPress={copyDraft}
          >
            {t('wiki_conflict_copy_draft')}
          </MultiButton>
          <MultiButton
            icon={<CheckIcon width={16} />}
            isPending={isSaving}
            isDisabled={!latest || !isSubmittable}
            onPress={() => latest && onOverwrite(latest.updatedAt)}
          >
            {t('wiki_conflict_overwrite')}
          </MultiButton>
        </div>
      }
    >
      <p className='text-sm'>{t('msg_wiki_page_conflict')}</p>
      {latest && (
        <p className='text-muted text-sm'>
          {t('wiki_updated_by', {
            name: latest.updatedByName ?? '-',
            at: dayformat(latest.updatedAt, 'tz-minute', tz),
          })}
        </p>
      )}
    </DialogModal>
  )
}
