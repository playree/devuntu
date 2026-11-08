'use client'

import { useLocale } from '@/locale/client'
import Link from 'next/link'
import { FC } from 'react'
import { useWikiSpace } from './space-context'

/** 直下のページの一覧(スペースのトップではスペース直下、ページ詳細では子ページ) */
export const ChildPages: FC<{ parentId: string | null }> = ({ parentId }) => {
  const { t } = useLocale()
  const { space, tree } = useWikiSpace()
  const pages = tree.filter((page) => page.parentId === parentId)
  if (pages.length === 0) {
    return null
  }

  return (
    <section className='space-y-2'>
      <h2 className='text-muted text-sm font-semibold'>{parentId ? t('wiki_child_pages') : t('wiki_pages')}</h2>
      <ul className='divide-y rounded-xl border'>
        {pages.map((page) => {
          const childCount = tree.filter((child) => child.parentId === page.id).length
          return (
            <li key={page.id}>
              <Link
                href={`/wiki/${space.key}/${page.number}`}
                className='flex items-center gap-2 px-3 py-2 text-sm hover:bg-mist-100 dark:hover:bg-neutral-900'
              >
                <span className='min-w-0 flex-1 truncate'>{page.title}</span>
                {childCount > 0 && (
                  <span className='text-muted shrink-0 text-xs'>{t('wiki_child_count', { count: childCount })}</span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
