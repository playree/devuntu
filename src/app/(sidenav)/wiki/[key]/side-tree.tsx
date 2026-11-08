'use client'

import { MultiButton } from '@/components/general/button'
import { InputSearchField } from '@/components/general/input'
import { useModalState } from '@/components/general/modal'
import { useSideNav } from '@/components/general/side-nav-slot'
import { TreeView, type TreeViewItem, type TreeViewItemPlace } from '@/components/general/tree-view'
import {
  ArrowRightCircleIcon,
  ArrowsUpDownIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Cog6ToothIcon,
  DocumentPlusIcon,
} from '@/components/icon'
import { WikiTagDots } from '@/components/wiki-tag'
import { parseAction } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { MAX_WIKI_SEARCH_KEYWORD, wikiSearchHref } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { cn } from '@heroui/react'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { FC, useMemo, useState } from 'react'
import { CreatePageModal, MovePageModal } from './page-modals'
import { moveWikiPage } from './server'
import { useWikiSpace } from './space-context'

/**
 * サイドメニューに差し込むスペースのツリー。
 * 編集モード(editor 以上)では、各行に上下の並べ替えと「移動」を出す
 */
export const WikiSideTree: FC = () => {
  const { t } = useLocale()
  const { space, access, tree, tagsOf, reloadSpace } = useWikiSpace()
  const { closeMenu } = useSideNav()
  const params = useParams<{ number?: string }>()
  const pathname = usePathname()
  const router = useRouter()
  const [isEditMode, setEditMode] = useState(false)
  const [pendingId, setPendingId] = useState<string>()
  const createModalState = useModalState()
  const moveModalState = useModalState<{ id: string; title: string; parentId: string | null }>()

  const items = useMemo<TreeViewItem[]>(
    () =>
      tree.map((page) => ({
        id: page.id,
        parentId: page.parentId,
        label: page.title,
        href: `/wiki/${space.key}/${page.number}`,
        suffix: <WikiTagDots tags={tagsOf(page.tagIds)} />,
      })),
    [space.key, tree, tagsOf],
  )
  const selectedId = tree.find((page) => String(page.number) === params.number)?.id ?? null
  const topHref = `/wiki/${space.key}`
  const canEdit = access.canWrite && isEditMode

  const reorder = async (item: TreeViewItem, { index }: TreeViewItemPlace, delta: -1 | 1) => {
    setPendingId(item.id)
    try {
      await parseAction(moveWikiPage({ id: item.id, parentId: item.parentId, position: index + delta }))
      await reloadSpace()
    } catch (e) {
      if (!(e instanceof ClientError)) {
        throw e
      }
    } finally {
      setPendingId(undefined)
    }
  }

  return (
    <div className='flex flex-col gap-1 px-2 pb-2'>
      <div className='flex items-center gap-1'>
        <Link
          href={topHref}
          title={space.name}
          aria-current={pathname === topHref ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold',
            pathname === topHref
              ? 'bg-accent-soft text-accent-soft-foreground'
              : 'hover:bg-mist-100 dark:hover:bg-neutral-900',
          )}
          onClick={closeMenu}
        >
          <BookOpenIcon width={16} className='shrink-0' />
          <span className='truncate'>{space.name}</span>
        </Link>
        {access.canWrite && (
          <>
            <MultiButton
              isIconOnly
              size='sm'
              variant='ghost'
              tooltip={t('wiki_add_page')}
              icon={<DocumentPlusIcon width={16} />}
              onPress={() => createModalState.open()}
            />
            <MultiButton
              isIconOnly
              size='sm'
              variant={isEditMode ? 'primary' : 'ghost'}
              tooltip={t('wiki_reorder_mode')}
              aria-pressed={isEditMode}
              icon={<ArrowsUpDownIcon width={16} />}
              onPress={() => setEditMode(!isEditMode)}
            />
          </>
        )}
        {access.canManage && (
          <MultiButton
            isIconOnly
            size='sm'
            variant='ghost'
            tooltip={t('settings')}
            icon={<Cog6ToothIcon width={16} />}
            onPress={() => {
              router.push(`${topHref}/settings`)
              closeMenu()
            }}
          />
        )}
      </div>

      {tree.length > 0 && (
        <InputSearchField // 見出しのボタンを増やすとスペース名が読めなくなるので、ツリーの上に置く
          isSmart
          aria-label={t('wiki_search')}
          placeholder={t('wiki_search')}
          maxLength={MAX_WIKI_SEARCH_KEYWORD}
          onSubmit={(value) => {
            if (value.trim()) {
              router.push(wikiSearchHref({ spaceKey: space.key, q: value.trim() }))
              closeMenu()
            }
          }}
        />
      )}

      {tree.length === 0 ? (
        <p className='text-muted px-2 py-1 text-xs'>{t('msg_no_wiki_pages')}</p>
      ) : (
        <TreeView
          aria-label={t('wiki_tree')}
          items={items}
          selectedId={selectedId}
          onNavigate={closeMenu}
          renderActions={
            canEdit
              ? (item, place) => (
                  <span className='flex shrink-0 items-center'>
                    <MultiButton
                      isIconOnly
                      size='sm'
                      variant='ghost'
                      className='size-6 min-w-6'
                      tooltip={t('move_up')}
                      icon={<ChevronUpIcon width={14} />}
                      isDisabled={place.index === 0 || !!pendingId}
                      onPress={() => reorder(item, place, -1)}
                    />
                    <MultiButton
                      isIconOnly
                      size='sm'
                      variant='ghost'
                      className='size-6 min-w-6'
                      tooltip={t('move_down')}
                      icon={<ChevronDownIcon width={14} />}
                      isDisabled={place.index === place.siblingCount - 1 || !!pendingId}
                      onPress={() => reorder(item, place, 1)}
                    />
                    <MultiButton
                      isIconOnly
                      size='sm'
                      variant='ghost'
                      className='size-6 min-w-6'
                      tooltip={t('wiki_move')}
                      icon={<ArrowRightCircleIcon width={14} />}
                      isDisabled={!!pendingId}
                      onPress={() => moveModalState.open({ id: item.id, title: item.label, parentId: item.parentId })}
                    />
                  </span>
                )
              : undefined
          }
        />
      )}

      <CreatePageModal state={createModalState} reload={reloadSpace} key={createModalState.key} parent={null} />
      {moveModalState.target && (
        <MovePageModal
          state={moveModalState}
          reload={reloadSpace}
          key={moveModalState.key}
          page={moveModalState.target}
        />
      )}
    </div>
  )
}
