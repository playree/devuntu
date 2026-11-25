'use client'

import { MultiButton } from '@/components/general/button'
import { PencilSquareIcon, XMarkIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { WikiAnnounceKindChip, WikiAnnounceSkipReason, WikiAnnounceStatusChip } from '@/components/wiki-chip'
import { parseAction } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import type { WikiAnnounceItem } from './page-announce-modal'
import { cancelWikiAnnouncementNotify } from './server'

/** 予定・送信の日時。送ったものは送った日時、それ以外は予定の日時 */
const AnnounceTime: FC<{ item: WikiAnnounceItem }> = ({ item }) => {
  const timezone = useUserTimezone()
  return (
    <span className='shrink-0 tabular-nums'>{dayformat(item.sentAt ?? item.scheduledAt, 'tz-minute', timezone)}</span>
  )
}

/**
 * ページの Slack 通知の履歴(新しい順)。予約中の行は、書ける人なら変更・取り消しできる
 */
export const WikiAnnounceHistory: FC<{
  items: WikiAnnounceItem[]
  canWrite: boolean
  onEdit: (item: WikiAnnounceItem) => void
  reload: () => void
}> = ({ items, canWrite, onEdit, reload }) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()

  const cancel = (item: WikiAnnounceItem) =>
    confirmAction(
      { title: t('wiki_announce_cancel'), text: t('msg_wiki_announce_cancel_confirm'), requireCheck: false },
      async () => {
        try {
          await parseAction(cancelWikiAnnouncementNotify({ id: item.id }))
          notify.success(t('msg_wiki_announce_canceled'))
        } finally {
          // 送信済みになっていた場合も、今の状態を見せる
          reload()
        }
      },
    )

  return (
    <section className='space-y-2'>
      <h2 className='text-muted text-sm font-semibold'>{t('wiki_announce_history')}</h2>
      {items.length === 0 ? (
        <p className='text-muted text-sm'>{t('msg_wiki_announce_history_empty')}</p>
      ) : (
        <ul className='divide-y rounded-xl border'>
          {items.map((item) => (
            <li key={item.id} className='flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm'>
              <WikiAnnounceStatusChip value={item.status} />
              <WikiAnnounceKindChip value={item.kind} />
              <AnnounceTime item={item} />
              <span className='text-muted shrink-0'>{item.senderName || '-'}</span>
              <span className='min-w-0 flex-1 truncate' title={item.message ?? undefined}>
                {item.message || <span className='text-muted'>{t('wiki_announce_message_excerpt')}</span>}
              </span>
              {item.status === 'skipped' && item.skipReason && (
                <span className='text-muted text-xs'>
                  <WikiAnnounceSkipReason reason={item.skipReason} />
                </span>
              )}
              {item.status === 'scheduled' && canWrite && (
                <span className='ml-auto flex shrink-0 gap-1'>
                  <MultiButton
                    isIconOnly
                    size='sm'
                    variant='ghost'
                    tooltip={t('wiki_announce_edit')}
                    icon={<PencilSquareIcon width={16} />}
                    onPress={() => onEdit(item)}
                  />
                  <MultiButton
                    isIconOnly
                    size='sm'
                    variant='ghost'
                    tooltip={t('wiki_announce_cancel')}
                    icon={<XMarkIcon width={16} />}
                    onPress={() => cancel(item)}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
