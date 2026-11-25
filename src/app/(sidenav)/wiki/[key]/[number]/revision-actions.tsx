import { MultiButton } from '@/components/general/button'
import { NoticePanel } from '@/components/general/panel'
import { ArrowUturnLeftIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { ticketShortPath } from '@/lib/board/ticket-id'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { Button } from '@heroui/react'
import Link from 'next/link'
import { FC } from 'react'
import { deleteWikiPageRevision, restoreWikiPageRevision } from '../server'
import type { WikiPageRevisions } from './use-wiki-page-revisions'

/** 選んでいる過去の版から最新への差分の表示の切り替え。過去の版を選んでいる間だけ出す */
export const WikiRevisionDiffToggle: FC<{ revisions: WikiPageRevisions }> = ({
  revisions: { past, isDiff, setDiff },
}) => {
  const { t } = useLocale()
  if (!past) {
    return null
  }
  return (
    <Button
      variant={isDiff ? 'primary' : 'outline'}
      size='sm'
      aria-pressed={isDiff}
      className='shrink-0'
      onPress={() => setDiff(!isDiff)}
    >
      {t('wiki_diff')}
    </Button>
  )
}

/**
 * 過去の版のロールバック(編集者以上)。タイトル・種類・本文・タグだけを戻し、位置は変えない。終わったら最新の版の表示に戻す
 */
export const WikiRevisionRestoreButton: FC<{ revisions: WikiPageRevisions }> = ({
  revisions: { past, select, reload },
}) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()
  if (!past) {
    return null
  }

  const restore = () =>
    confirmAction(
      { title: t('restore'), text: t('msg_confirm_restore_wiki_page', { target: past.title }) },
      async () => {
        const result = await parseAction(restoreWikiPageRevision({ id: past.id }))
        if (result.result === 'unchanged') {
          notify.info(t('msg_wiki_restore_unchanged'))
          return
        }
        notify.success(t('msg_restored_target', { target: past.title }))
        select(null)
        await reload()
      },
    )

  return (
    <MultiButton
      isIconOnly
      size='sm'
      variant='outline'
      tooltip={t('wiki_restore_this')}
      icon={<ArrowUturnLeftIcon width={16} />}
      onPress={restore}
    />
  )
}

/** 過去の版の削除(`canDeleteWikiRevision`)。終わったら最新の版の表示に戻す */
export const WikiRevisionDeleteButton: FC<{ revisions: WikiPageRevisions }> = ({
  revisions: { past, select, reload },
}) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()
  if (!past) {
    return null
  }

  const remove = () =>
    confirmAction(
      { title: t('delete'), text: t('msg_confirm_delete_wiki_revision', { target: `v${past.number}` }) },
      async () => {
        await parseAction(deleteWikiPageRevision({ id: past.id }))
        notify.success(t('msg_deleted_target', { target: `v${past.number}` }))
        select(null)
        await reload()
      },
    )

  return (
    <MultiButton // ヘッダーのページの削除(アイコンのみ)と見分けられるよう、文言を出す
      size='sm'
      variant='danger-soft'
      className='shrink-0'
      icon={<TrashIcon width={16} />}
      onPress={remove}
    >
      {t('wiki_delete_revision')}
    </MultiButton>
  )
}

/** 過去の版を表示していることの注記。コミットメッセージ・チケット・版の保持期間も添える */
export const WikiPastRevisionNotice: FC<{ revisions: WikiPageRevisions }> = ({
  revisions: { past, retention, isDiff },
}) => {
  const { t } = useLocale()
  if (!past) {
    return null
  }
  return (
    <NoticePanel status='warning'>
      {t(isDiff ? 'msg_wiki_viewing_diff' : 'msg_wiki_viewing_revision', { target: `v${past.number}` })}
      {past.ticketDisplayId && (
        <>
          {' '}
          <Link className='text-accent' href={ticketShortPath(past.ticketDisplayId)}>
            {past.ticketDisplayId}
          </Link>
        </>
      )}
      {past.message && `\n${past.message}`}
      {`\n${t('msg_wiki_revision_retention', {
        days: retention?.retentionDays ?? '-',
        keep: retention?.keepRecent ?? '-',
        max: retention?.maxPerPage ?? '-',
      })}`}
    </NoticePanel>
  )
}
