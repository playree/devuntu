'use client'

import { useServerPagingList } from '@/components/general/paging'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectField } from '@/components/general/select'
import { TablePaging } from '@/components/general/table-paging'
import { TagChips } from '@/components/ticket/ticket-chip'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import {
  groupWikiAnnouncementArchive,
  type WikiAnnouncementFilter,
  wikiAnnouncementHref,
} from '@/lib/wiki/wiki-announcement-rule'
import { useLocale } from '@/locale/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useMemo, useRef } from 'react'
import { tv } from 'tailwind-variants'
import { getWikiAnnouncementArchive, getWikiAnnouncements, type GetWikiAnnouncementsReturnType } from './server'
import { useWikiSpace } from './space-context'

type Announcement = NonNullable<GetWikiAnnouncementsReturnType>['items'][number]

/** スペースのツリーを取り直したとき(作成・削除・改名、リロード)に呼ぶ */
const useOnSpaceReloaded = (callback: () => void) => {
  const { tree } = useWikiSpace()
  const shown = useRef(tree)
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  })
  useEffect(() => {
    if (shown.current !== tree) {
      shown.current = tree
      callbackRef.current()
    }
  }, [tree])
}

/** 年月(YYYY-MM)の表示。月は 0 埋めしない数(「11月」)と、0 埋めした 2 桁(「11/2026」の 11)の両方を渡す */
const useMonthLabel = () => {
  const { t } = useLocale()
  return (month: string) =>
    t('wiki_announcement_month', { year: month.slice(0, 4), month: Number(month.slice(5, 7)), mm: month.slice(5, 7) })
}

/** アナウンスの 1 行。タイトル・作成日時・作成者・タグ */
const AnnouncementRow: FC<{ item: Announcement }> = ({ item }) => {
  const { space, tagsOf } = useWikiSpace()
  const tz = useUserTimezone()
  const tags = tagsOf(item.tagIds)

  return (
    <li>
      <Link
        href={`/wiki/${space.key}/${item.number}`}
        className='flex flex-col gap-1 px-3 py-2 hover:bg-mist-100 sm:flex-row sm:items-center sm:gap-3 dark:hover:bg-neutral-900'
      >
        <span className='min-w-0 flex-1 truncate text-sm font-medium'>{item.title}</span>
        <span className='text-muted flex min-w-0 flex-wrap items-center gap-2 text-xs sm:shrink-0'>
          {tags.length > 0 && <TagChips tags={tags} />}
          <span>{item.createdByName || '-'}</span>
          <span className='font-mono'>{dayformat(item.createdAt, 'tz-minute', tz)}</span>
        </span>
      </Link>
    </li>
  )
}

/**
 * 新しい順の一覧。絞り込みが変わったら作り直す(呼び出し側で key を変える)ので、ページは先頭から始まる
 */
const AnnouncementList: FC<{ filter: WikiAnnouncementFilter; tagId: string | undefined }> = ({ filter, tagId }) => {
  const { t } = useLocale()
  const { space } = useWikiSpace()
  const list = useServerPagingList<Announcement>({
    loadPage: async ({ page, rowsPerPage }) =>
      await parseAction(
        getWikiAnnouncements({ id: space.id, month: filter.month, year: filter.year, tagId, page, rowsPerPage }),
      ),
  })
  useOnSpaceReloaded(list.reload)

  if (list.isLoading && list.items.length === 0) {
    return <PanelSkeleton />
  }

  return (
    <div className='space-y-2'>
      {list.items.length === 0 ? (
        <p className='text-muted text-sm'>{t('msg_no_wiki_announcements')}</p>
      ) : (
        <ul className='divide-y rounded-xl border'>
          {list.items.map((item) => (
            <AnnouncementRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      <TablePaging {...list} />
    </div>
  )
}

const archiveLink = tv({
  base: 'inline-block rounded-lg px-2 py-0.5 text-sm hover:bg-mist-100 dark:hover:bg-neutral-900',
  variants: { isActive: { true: 'bg-accent-soft text-accent-soft-foreground font-semibold' } },
})

/** 年月ごとの件数。月(年)を押すとその期間だけにする */
const AnnouncementArchive: FC<{ filter: WikiAnnouncementFilter; tagId: string | undefined }> = ({ filter, tagId }) => {
  const { t } = useLocale()
  const { space } = useWikiSpace()
  // タグで絞り込んでいる間は、件数もそのタグのアナウンスだけを数える(押した先の一覧の件数と揃える)
  const { data, isLoading, refresh } = useActionData(() => getWikiAnnouncementArchive({ id: space.id, tagId }), {
    key: `${space.id}/${tagId ?? ''}`,
  })
  useOnSpaceReloaded(refresh)
  const years = useMemo(() => groupWikiAnnouncementArchive(data ?? []), [data])
  const monthLabel = useMonthLabel()
  const hrefOf = (period: Pick<WikiAnnouncementFilter, 'month' | 'year'>) =>
    wikiAnnouncementHref(space.key, { ...period, tag: filter.tag })
  const isAll = !filter.month && !filter.year

  return (
    <section id='archive' className='scroll-mt-4 space-y-2'>
      <h2 className='text-muted text-sm font-semibold'>{t('wiki_announcement_archive')}</h2>
      {isLoading ? (
        <PanelSkeleton />
      ) : !data ? (
        <NoticePanel status='danger'>{t('msg_wiki_announcements_load_failed')}</NoticePanel>
      ) : (
        <div className='space-y-2'>
          <Link href={hrefOf({})} className={archiveLink({ isActive: isAll })}>
            {t('wiki_announcement_all')}
          </Link>
          {years.map(({ year, count, months }) => (
            <div key={year} className='space-y-1'>
              <Link href={hrefOf({ year })} className={archiveLink({ isActive: filter.year === year })}>
                {t('wiki_announcement_year', { year })}
                <span className='text-muted ml-1 text-xs'>{t('wiki_announcement_count', { count })}</span>
              </Link>
              <div className='flex flex-wrap gap-1 pl-2 lg:flex-col lg:items-start'>
                {months.map(({ month, count: monthCount }) => (
                  <Link
                    key={month}
                    href={hrefOf({ month })}
                    className={archiveLink({ isActive: filter.month === month })}
                  >
                    {monthLabel(month)}
                    <span className='text-muted ml-1 text-xs'>
                      {t('wiki_announcement_count', { count: monthCount })}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * アナウンス用スペースのトップ。新しい順の一覧(タグ・年月で絞り込み、サーバー側でページング)とバックナンバー。
 * 絞り込みは URL のクエリに持つ。広い画面ではバックナンバーを一覧の右に、狭い画面では一覧の下に置く
 */
export const WikiAnnouncementIndex: FC<{ filter: WikiAnnouncementFilter }> = ({ filter }) => {
  const { t } = useLocale()
  const router = useRouter()
  const { space, tags } = useWikiSpace()
  const tagOptions = Object.fromEntries(tags.map((tag) => [tag.name, tag.name]))
  const tagId = filter.tag ? tags.find((tag) => tag.name === filter.tag)?.id : undefined
  // 無いタグ名(削除・改名された)で開いたときは、絞り込まずに全件を出す
  const shownTag = tagId ? filter.tag : undefined
  const monthLabel = useMonthLabel()
  const periodLabel = filter.month
    ? monthLabel(filter.month)
    : filter.year
      ? t('wiki_announcement_year', { year: filter.year })
      : t('wiki_announcement_all')

  return (
    <div className='flex flex-col gap-4 lg:flex-row lg:items-start'>
      <section className='min-w-0 flex-1 space-y-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <h2 className='text-muted text-sm font-semibold'>{periodLabel}</h2>
          {tags.length > 0 && (
            <div className='ml-auto w-full sm:w-56'>
              <SingleSelectField
                isSmart
                isLabelHidden
                isClearable
                label={t('tags')}
                placeholder={t('tags')}
                groupOptions={tagOptions}
                value={shownTag ?? null}
                onChange={(tag) =>
                  router.push(wikiAnnouncementHref(space.key, { ...filter, tag: tag ?? undefined }), { scroll: false })
                }
              />
            </div>
          )}
        </div>
        <AnnouncementList
          key={`${filter.month ?? ''}/${filter.year ?? ''}/${tagId ?? ''}`}
          filter={filter}
          tagId={tagId}
        />
      </section>
      <aside className='shrink-0 lg:w-48'>
        <AnnouncementArchive filter={{ ...filter, tag: shownTag }} tagId={tagId} />
      </aside>
    </div>
  )
}
