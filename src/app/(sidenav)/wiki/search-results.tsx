'use client'

import { MultiButton } from '@/components/general/button'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ArrowPathIcon, BookOpenIcon } from '@/components/icon'
import { WikiTagLinks } from '@/components/wiki-tag'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { MAX_WIKI_SEARCH_LIMIT, wikiPagePath } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import Link from 'next/link'
import { FC } from 'react'
import type { SearchWikiPagesReturnType } from './server'

type WikiSearchHit = NonNullable<SearchWikiPagesReturnType>[number]

/**
 * 検索結果の一覧(横断検索とスペース内検索で共有)。
 * タイトルをページへのリンクにし、パンくず・タグ・一致した箇所の前後・更新日時を添える
 */
export const WikiSearchResults: FC<{
  hits: readonly WikiSearchHit[] | undefined
  isLoading: boolean
  /** 横断検索ではパンくずの先頭にスペース名を出す */
  showSpace: boolean
  /** 取得に失敗したときの検索し直し(同じ条件では URL が変わらず取り直されないため) */
  onRetry: () => void
}> = ({ hits, isLoading, showSpace, onRetry }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()

  if (isLoading) {
    return <PanelSkeleton />
  }
  if (!hits) {
    return (
      <div className='flex flex-col items-start gap-2'>
        <NoticePanel // 取得に失敗した(一致するページが無いのと区別する)
          status='danger'
        >
          {t('msg_wiki_search_failed')}
        </NoticePanel>
        <MultiButton size='sm' icon={<ArrowPathIcon />} onPress={onRetry}>
          {t('reload')}
        </MultiButton>
      </div>
    )
  }
  if (hits.length === 0) {
    return <p className='text-muted text-sm'>{t('msg_no_wiki_search_results')}</p>
  }

  return (
    <section className='space-y-2'>
      <p className='text-muted text-xs'>
        {t(hits.length >= MAX_WIKI_SEARCH_LIMIT ? 'wiki_search_result_count_over' : 'wiki_search_result_count', {
          count: hits.length,
        })}
      </p>
      <ul className='divide-y rounded-xl border'>
        {hits.map((hit) => {
          const breadcrumbs = showSpace ? [hit.space.name, ...hit.breadcrumbs] : hit.breadcrumbs
          return (
            <li key={hit.id} className='space-y-1 px-3 py-2'>
              {breadcrumbs.length > 0 && (
                <p className='text-muted flex min-w-0 items-center gap-1 text-xs'>
                  {showSpace && <BookOpenIcon width={12} className='shrink-0' />}
                  <span className='truncate'>{breadcrumbs.join(' › ')}</span>
                </p>
              )}
              <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                <Link
                  href={wikiPagePath({ key: hit.space.key, number: hit.number })}
                  className='min-w-0 font-semibold wrap-break-word hover:underline'
                >
                  {hit.title}
                </Link>
                <span className='text-muted font-mono text-xs'>{hit.ref}</span>
              </div>
              {hit.snippet && <p className='text-muted line-clamp-2 text-sm wrap-break-word'>{hit.snippet}</p>}
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <WikiTagLinks spaceKey={hit.space.key} tags={hit.tags} />
                <span className='text-muted ml-auto text-xs'>{dayformat(hit.updatedAt, 'tz-minute', tz)}</span>
              </div>
            </li>
          )
        })}
      </ul>
      {hits.length >= MAX_WIKI_SEARCH_LIMIT && (
        <p className='text-muted text-xs'>{t('msg_wiki_search_limit', { max: MAX_WIKI_SEARCH_LIMIT })}</p>
      )}
    </section>
  )
}
