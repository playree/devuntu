'use client'

import { MultiButton } from '@/components/general/button'
import { ChevronDownIcon } from '@/components/general/icons'
import { NoticePanel } from '@/components/general/panel'
import { ArrowUturnLeftIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { UpdatedBy } from '@/components/updated-by'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { ticketShortPath } from '@/lib/board/ticket-id'
import { dayformat } from '@/lib/day'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { Button, Chip, cn, Dropdown } from '@heroui/react'
import Link from 'next/link'
import { FC, useEffect, useRef, useState } from 'react'
import {
  deleteWikiPageRevision,
  getWikiPageRevisionContent,
  getWikiPageRevisions,
  type GetWikiPageRevisionsReturnType,
  restoreWikiPageRevision,
} from '../server'
import { useWikiSpace } from '../space-context'
import type { GetWikiPageReturnType } from './server'

type Page = NonNullable<GetWikiPageReturnType>['page']
type Revision = NonNullable<GetWikiPageRevisionsReturnType>['revisions'][number]

/**
 * ページの版の一覧と、選んでいる版。最新の版はいまの内容と同じなので、過去の版(`past`)を選んだときだけ本文を引く。
 * ページを取り直して更新日時が変わったら(保存・ロールバック・再読み込み)一覧も取り直す
 */
export const useWikiPageRevisions = (page: Page) => {
  const { data, refresh } = useActionData(() => getWikiPageRevisions({ id: page.id }), { key: page.id })
  const updatedAt = page.updatedAt.getTime()
  const fetchedAt = useRef(updatedAt)
  useEffect(() => {
    if (fetchedAt.current !== updatedAt) {
      fetchedAt.current = updatedAt
      void refresh()
    }
  }, [updatedAt, refresh])

  const revisions = data?.revisions ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 一覧から消えた版(削除・掃除)を選んでいたら最新に戻る
  const selected = revisions.find(({ id }) => id === selectedId)
  const past = selected && selected.id !== revisions[0]?.id ? selected : undefined
  const content = useActionData(() => getWikiPageRevisionContent({ id: past?.id ?? '' }), {
    skip: !past,
    key: past?.id,
  })

  return {
    revisions,
    retention: data,
    past,
    pastContent: past ? content.data : undefined,
    isPastLoading: !!past && content.isLoading,
    select: setSelectedId,
    refresh,
  }
}

export type WikiPageRevisions = ReturnType<typeof useWikiPageRevisions>

/** 版の内容(過去の版)で表示するタイトル・種類・タグ。タグは名前で持つので、いまスペースに残っているものだけ出す */
export const usePastPageView = (past: Revision | undefined) => {
  const { tags } = useWikiSpace()
  if (!past) {
    return undefined
  }
  return {
    title: past.title,
    type: past.type,
    tags: past.tagNames.flatMap((name) => tags.filter((tag) => tag.name === name)),
  }
}

const RevisionNumber: FC<{ number: number }> = ({ number }) => (
  <span className='text-muted font-mono text-xs'>v{number}</span>
)

/** 版の一覧の1項目 */
const RevisionItem: FC<{ revision: Revision; revisions: readonly Revision[]; isLatest: boolean }> = ({
  revision,
  revisions,
  isLatest,
}) => {
  const { t } = useLocale()
  const source = revision.restoredFromId && revisions.find(({ id }) => id === revision.restoredFromId)
  return (
    <div className='min-w-0 space-y-0.5'>
      <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm'>
        <RevisionNumber number={revision.number} />
        {t(`wiki_revision_action_${revision.action}`)}
        {source && (
          <span className='text-muted text-xs'>{t('wiki_revision_restored_from', { version: source.number })}</span>
        )}
        {isLatest && (
          <Chip color='accent' variant='soft' size='sm'>
            <Chip.Label>{t('wiki_revision_latest')}</Chip.Label>
          </Chip>
        )}
        {revision.beforeRetention && (
          <Chip color='warning' variant='soft' size='sm'>
            <Chip.Label>{t('wiki_revision_before_retention')}</Chip.Label>
          </Chip>
        )}
        {revision.ticketDisplayId && <span className='text-muted text-xs'>{revision.ticketDisplayId}</span>}
      </div>
      {revision.message && <p className='line-clamp-2 text-xs break-all whitespace-pre-line'>{revision.message}</p>}
      <UpdatedBy name={revision.actorName} isAgent={revision.actorIsAgent} via={revision.via} at={revision.updatedAt} />
    </div>
  )
}

/**
 * 更新者・日時を兼ねた版の選択。版が取れていなければ(取得中・旧データ)文言だけを出す。
 * 過去の版を選んでいる間は、その版の版数・更新者・日時を注意色で出す
 */
export const WikiRevisionSelect: FC<{ revisions: WikiPageRevisions; updatedText: string }> = ({
  revisions: { revisions, past, select },
  updatedText,
}) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  if (revisions.length === 0) {
    return <span className='text-muted text-xs'>{updatedText}</span>
  }
  const current = past ?? revisions[0]
  const label = past
    ? `v${past.number} · ${t('wiki_updated_by', { name: past.actorName || '-', at: dayformat(past.updatedAt, 'tz-minute', tz) })}`
    : updatedText
  return (
    <Dropdown>
      <Button
        variant='ghost'
        size='sm'
        aria-label={`${t('history')}: ${label}`}
        className={cn(
          'h-auto min-h-0 gap-1 px-1 py-0.5 text-xs font-normal whitespace-normal',
          past ? 'text-warning' : 'text-muted',
        )}
      >
        {label}
        <ChevronDownIcon width={12} className='shrink-0' />
      </Button>
      <Dropdown.Popover className='w-[min(28rem,calc(100vw-2rem))]'>
        <Dropdown.Menu
          aria-label={t('history')}
          className='max-h-[60vh] overflow-y-auto'
          disallowEmptySelection
          selectionMode='single'
          selectedKeys={[current.id]}
          onAction={(key) => select(String(key))}
        >
          {revisions.map((revision, index) => (
            <Dropdown.Item
              key={revision.id}
              id={revision.id}
              textValue={`v${revision.number}`}
              className='min-h-min items-start py-1'
            >
              <Dropdown.ItemIndicator />
              <RevisionItem revision={revision} revisions={revisions} isLatest={index === 0} />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

/**
 * 過去の版のロールバックと削除(編集者以上)。ロールバックはタイトル・種類・本文・タグだけを戻し、位置は変えない。
 * どちらも終わったら最新の版の表示に戻す
 */
export const WikiRevisionActions: FC<{
  revisions: WikiPageRevisions
  onRestored: () => Promise<void>
}> = ({ revisions: { past, select, refresh }, onRestored }) => {
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
        await onRestored()
      },
    )

  const remove = () =>
    confirmAction(
      { title: t('delete'), text: t('msg_confirm_delete_wiki_revision', { target: `v${past.number}` }) },
      async () => {
        await parseAction(deleteWikiPageRevision({ id: past.id }))
        notify.success(t('msg_deleted_target', { target: `v${past.number}` }))
        select(null)
        await refresh()
      },
    )

  return (
    <div className='flex shrink-0 gap-1'>
      <MultiButton
        isIconOnly
        size='sm'
        variant='outline'
        tooltip={t('wiki_restore_this')}
        icon={<ArrowUturnLeftIcon width={16} />}
        onPress={restore}
      />
      <MultiButton
        isIconOnly
        size='sm'
        variant='outline'
        tooltip={t('wiki_delete_revision')}
        icon={<TrashIcon width={16} />}
        onPress={remove}
      />
    </div>
  )
}

/** 過去の版を表示していることの注記。コミットメッセージ・チケット・版の保持期間も添える */
export const WikiPastRevisionNotice: FC<{ revisions: WikiPageRevisions }> = ({ revisions: { past, retention } }) => {
  const { t } = useLocale()
  if (!past) {
    return null
  }
  return (
    <NoticePanel status='warning'>
      {t('msg_wiki_viewing_revision', { target: `v${past.number}` })}
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
