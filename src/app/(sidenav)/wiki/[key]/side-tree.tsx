'use client'

import { MultiButton } from '@/components/general/button'
import { InputSearchField } from '@/components/general/input'
import { usePushIfLeavable } from '@/components/general/leave-guard'
import { useModalState } from '@/components/general/modal'
import { useSideNav } from '@/components/general/side-nav-slot'
import { TreeView, type TreeViewItem, type TreeViewItemPlace } from '@/components/general/tree-view'
import {
  ArrowsUpDownIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Cog6ToothIcon,
  DocumentPlusIcon,
  FolderArrowRightIcon,
} from '@/components/icon'
import { WikiTagDots } from '@/components/wiki-tag'
import { parseAction } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import {
  MAX_WIKI_SEARCH_KEYWORD,
  wikiPagePath,
  wikiSearchHref,
  wikiSettingsPath,
  wikiSpaceTypeSpec,
} from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { useParams } from 'next/navigation'
import { FC, useMemo, useState } from 'react'
import { CreatePageModal, MovePageModal } from './page-modals'
import { reorderWikiPage } from './server'
import { WikiSideAnnouncements } from './side-announcements'
import { useWikiSpace } from './space-context'
import { WikiSpaceSwitcher } from './space-switcher'

/**
 * サイドメニューに差し込むスペースのツリー。
 * 編集モード(editor 以上)では、各行に上下の並べ替えと「移動」を出す。
 * アナウンス用スペースは平らで増え続けるので、ツリーと並べ替えの代わりに最新のアナウンスとバックナンバーへのリンクを出す
 */
export const WikiSideTree: FC = () => {
  const { t } = useLocale()
  const { space, access, tree, tagsOf, reloadSpace } = useWikiSpace()
  const pushIfLeavable = usePushIfLeavable()
  const { closeMenu } = useSideNav()
  // 下書きを捨てるかの確認で断られたら、ドロワーは閉じない
  const closeMenuIfMoved = (moved: boolean) => {
    if (moved) {
      closeMenu()
    }
  }
  const params = useParams<{ number?: string }>()
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
        href: wikiPagePath({ key: space.key, number: page.number }),
        suffix: <WikiTagDots tags={tagsOf(page.tagIds)} />,
      })),
    [space.key, tree, tagsOf],
  )
  const selectedId = tree.find((page) => String(page.number) === params.number)?.id ?? null
  const canEdit = access.canWrite && isEditMode
  const spec = wikiSpaceTypeSpec(space.type)

  const reorder = async (item: TreeViewItem, { index }: TreeViewItemPlace, delta: -1 | 1) => {
    setPendingId(item.id)
    try {
      const siblingIds = tree.filter((page) => page.parentId === item.parentId).map(({ id }) => id)
      await parseAction(reorderWikiPage({ id: item.id, parentId: item.parentId, siblingIds, position: index + delta }))
      await reloadSpace()
    } catch (e) {
      if (!(e instanceof ClientError)) {
        throw e
      }
      // 他の人が別の親へ移した・兄弟を増減したなど、画面のツリーが古い。通知は parseAction が済ませている
      await reloadSpace()
    } finally {
      setPendingId(undefined)
    }
  }

  return (
    <div className='flex flex-col gap-1 px-2 pb-2'>
      <div className='flex items-center gap-1'>
        <WikiSpaceSwitcher />
        <span className='flex shrink-0 items-center'>
          {access.canWrite && (
            <>
              <MultiButton
                isIconOnly
                size='sm'
                variant='ghost'
                className='size-7 min-w-7'
                tooltip={spec.announce ? t('wiki_new_announcement') : t('wiki_add_page')}
                icon={<DocumentPlusIcon width={16} />}
                onPress={() => createModalState.open()}
              />
              {!spec.flat && (
                <MultiButton
                  isIconOnly
                  size='sm'
                  variant={isEditMode ? 'primary' : 'ghost'}
                  className='size-7 min-w-7'
                  tooltip={t('wiki_reorder_mode')}
                  aria-pressed={isEditMode}
                  icon={<ArrowsUpDownIcon width={16} />}
                  onPress={() => setEditMode(!isEditMode)}
                />
              )}
            </>
          )}
          {access.canManage && (
            <MultiButton
              isIconOnly
              size='sm'
              variant='ghost'
              className='size-7 min-w-7'
              tooltip={t('settings')}
              icon={<Cog6ToothIcon width={16} />}
              onPress={() => void pushIfLeavable(wikiSettingsPath(space.key)).then(closeMenuIfMoved)}
            />
          )}
        </span>
      </div>

      {(spec.flat || tree.length > 0) && (
        <InputSearchField // 見出しのボタンを増やすとスペース名が読めなくなるので、ツリーの上に置く
          isSmart
          aria-label={t('wiki_search')}
          placeholder={t('wiki_search')}
          maxLength={MAX_WIKI_SEARCH_KEYWORD}
          onSubmit={(value) => {
            if (value.trim()) {
              void pushIfLeavable(wikiSearchHref({ spaceKey: space.key, q: value.trim() })).then(closeMenuIfMoved)
            }
          }}
        />
      )}

      {spec.index === 'announcement' ? (
        <WikiSideAnnouncements onNavigate={closeMenu} />
      ) : tree.length === 0 ? (
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
                  <span // lg 未満は指で押し分けられるよう、ツリーの行(32px)に合わせて大きくする
                    className='flex shrink-0 items-center'
                  >
                    <MultiButton
                      isIconOnly
                      size='sm'
                      variant='ghost'
                      className='size-6 min-w-6 max-lg:size-8 max-lg:min-w-8'
                      tooltip={t('move_up')}
                      icon={<ChevronUpIcon width={14} />}
                      isDisabled={place.index === 0 || !!pendingId}
                      onPress={() => reorder(item, place, -1)}
                    />
                    <MultiButton
                      isIconOnly
                      size='sm'
                      variant='ghost'
                      className='size-6 min-w-6 max-lg:size-8 max-lg:min-w-8'
                      tooltip={t('move_down')}
                      icon={<ChevronDownIcon width={14} />}
                      isDisabled={place.index === place.siblingCount - 1 || !!pendingId}
                      onPress={() => reorder(item, place, 1)}
                    />
                    <MultiButton
                      isIconOnly
                      size='sm'
                      variant='ghost'
                      className='size-6 min-w-6 max-lg:size-8 max-lg:min-w-8'
                      tooltip={t('wiki_move')}
                      icon={<FolderArrowRightIcon width={14} />}
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
