'use client'

import { PanelSpinner } from '@/components/general/panel'
import { TreeView, type TreeViewItem } from '@/components/general/tree-view'
import { WikiAnnounceStateIcon } from '@/components/wiki-chip'
import { WikiTagDots } from '@/components/wiki-tag'
import { useActionData } from '@/lib/action/action-client'
import { WIKI_ANNOUNCEMENT_SIDEBAR_LIMIT } from '@/lib/wiki/wiki-announcement-rule'
import { wikiPagePath, wikiSpacePath } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { FC, useEffect, useMemo, useRef } from 'react'
import { getWikiAnnouncements } from './server'
import { useWikiSpace } from './space-context'

/**
 * アナウンス用スペースのサイドメニュー。全件のツリーの代わりに最新のアナウンスと、トップのバックナンバーへのリンクを出す
 */
export const WikiSideAnnouncements: FC<{ onNavigate: () => void }> = ({ onNavigate }) => {
  const { t } = useLocale()
  const { space, tree, tagsOf } = useWikiSpace()
  const params = useParams<{ number?: string }>()
  const { data, isLoading, refresh } = useActionData(
    () => getWikiAnnouncements({ id: space.id, page: 1, rowsPerPage: WIKI_ANNOUNCEMENT_SIDEBAR_LIMIT }),
    { key: space.id },
  )

  // スペースを取り直したとき(作成・削除・改名、リロード)は最新の一覧も取り直す
  const shownTree = useRef(tree)
  useEffect(() => {
    if (shownTree.current !== tree) {
      shownTree.current = tree
      void refresh()
    }
  }, [tree, refresh])

  const items = useMemo<TreeViewItem[]>(
    () =>
      (data?.items ?? []).map((item) => ({
        id: item.id,
        parentId: null,
        label: item.title,
        href: wikiPagePath({ key: space.key, number: item.number }),
        suffix: (
          <span className='flex items-center gap-1'>
            <WikiTagDots tags={tagsOf(item.tagIds)} />
            {item.notifyState && <WikiAnnounceStateIcon value={item.notifyState} />}
          </span>
        ),
      })),
    [data, space.key, tagsOf],
  )
  const selectedId = data?.items.find((item) => String(item.number) === params.number)?.id ?? null

  if (isLoading) {
    return <PanelSpinner />
  }

  return (
    <div className='flex flex-col gap-1'>
      <p className='text-muted px-2 pt-1 text-xs font-semibold'>{t('wiki_announcement_latest')}</p>
      {items.length === 0 ? (
        <p className='text-muted px-2 py-1 text-xs'>{t('msg_no_wiki_announcements')}</p>
      ) : (
        <TreeView
          aria-label={t('wiki_announcement_latest')}
          items={items}
          selectedId={selectedId}
          onNavigate={onNavigate}
        />
      )}
      <Link
        href={`${wikiSpacePath(space.key)}#archive`}
        className='text-accent px-2 py-1 text-xs underline-offset-2 hover:underline'
        onClick={onNavigate}
      >
        {t('wiki_announcement_archive')}
      </Link>
    </div>
  )
}
