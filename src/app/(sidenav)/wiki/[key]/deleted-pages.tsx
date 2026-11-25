'use client'

import { MultiButton } from '@/components/general/button'
import { DialogModal, useModalState } from '@/components/general/modal'
import { PanelSkeleton } from '@/components/general/panel'
import { ArrowTopRightOnSquareIcon, ArrowUturnLeftIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { UpdatedBy } from '@/components/updated-by'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { isFlatWikiSpace, WIKI_TREE_CHANGED, wikiPagePath } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'
import { tv } from 'tailwind-variants'
import { getDeletedWikiPages, restoreDeletedWikiPage, type GetDeletedWikiPagesReturnType } from './server'
import { useWikiSpace } from './space-context'

type DeletedPage = NonNullable<GetDeletedWikiPagesReturnType>['pages'][number]

const row = tv({
  base: 'border-border flex items-center gap-2 rounded-lg border px-2 py-1',
  variants: {
    // スマホ幅でも潰れないよう、字下げは 4 段で止める
    indent: { 0: '', 1: 'ms-3', 2: 'ms-6', 3: 'ms-9', 4: 'ms-12' },
  },
})

const rowBody = tv({
  base: 'min-w-0 flex-1 space-y-0.5',
  variants: { isRestored: { true: 'opacity-60' } },
})

const indentOf = (depth: number) => Math.min(depth, 4) as 0 | 1 | 2 | 3 | 4

/**
 * 一覧の `index` の行と一緒に戻る配下(一覧で後に続く、段の深い行)。
 * 復元済みの行は親子がつながらなくなる(サーバーは削除済みの親をたどって配下を探す)ので、その行と配下は含めない
 */
const restorableDescendantsAt = (
  pages: readonly DeletedPage[],
  index: number,
  restored: ReadonlySet<string>,
): DeletedPage[] => {
  const result: DeletedPage[] = []
  let skipBelow: number | undefined
  for (const page of pages.slice(index + 1)) {
    if (page.depth <= pages[index].depth) {
      break
    }
    if (skipBelow !== undefined && page.depth > skipBelow) {
      continue
    }
    skipBelow = undefined
    if (restored.has(page.id)) {
      skipBelow = page.depth
    } else {
      result.push(page)
    }
  }
  return result
}

/**
 * 削除済みのページの一覧。削除したときの内容・タグ・作成者のまま戻る(削除前の内容は、復元したページの履歴で確かめられる)。
 * 一覧は元の親 → 子の順で、上から順に復元すれば元の親子関係に戻る。配下ごとの復元は1回の操作でまとめて戻す。
 * 復元してもモーダルは閉じず、開き直すまで一覧は取り直さない(配下が変わっていて弾かれたときだけ取り直す)。復元した行はページを開くボタンに替える
 */
export const DeletedPagesModal: FC<{ state: ReturnType<typeof useModalState<string>> }> = ({ state }) => {
  const { t } = useLocale()
  const router = useRouter()
  const confirmAction = useConfirmAction()
  const { space, access, reloadSpace } = useWikiSpace()
  const { data, isLoading, reload } = useActionData(() => getDeletedWikiPages({ id: space.id }), {
    skip: !state.isOpen,
    key: `${space.id}_${state.isOpen}`,
  })
  /** 復元したページの ID */
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set())
  const [isRestoring, setIsRestoring] = useState(false)

  const pages = data?.pages ?? []
  // アナウンス用スペースは平らで、どのページもスペース直下に戻るので、元の親は示さない
  const isFlat = isFlatWikiSpace(space.type)

  /**
   * 戻して、戻した行を復元済みにする。
   * 確認で見せた配下と今の削除済みの配下が違えば(WIKI_TREE_CHANGED)何も戻っていないので、一覧を取り直して確認し直せるようにする
   */
  const restorePage = async (page: DeletedPage, descendants: readonly DeletedPage[]) => {
    setIsRestoring(true)
    try {
      const result = await parseAction(
        restoreDeletedWikiPage({ id: page.id, descendantIds: descendants.map(({ id }) => id) }),
      )
      setRestored((prev) => new Set([...prev, page.id, ...descendants.map(({ id }) => id)]))
      return result
    } catch (e) {
      if (e instanceof ClientError && e.errorType === WIKI_TREE_CHANGED) {
        await reload()
      }
      throw e
    } finally {
      setIsRestoring(false)
      await reloadSpace()
    }
  }

  /** 元の親が削除されたまま(この一覧で未復元)なら、その親 */
  const deletedParentOf = (page: DeletedPage) =>
    !isFlat && page.parent.state === 'deleted' && !restored.has(page.parent.pageId) ? page.parent : undefined

  const restore = (page: DeletedPage) => {
    const parent = deletedParentOf(page)
    const text = parent
      ? t('msg_confirm_restore_deleted_wiki_page_parent_deleted', { target: page.title, parent: parent.title })
      : t('msg_confirm_restore_deleted_wiki_page', { target: page.title })
    return confirmAction({ title: t('restore'), text }, async () => {
      if ((await restorePage(page, [])).result === 'unchanged') {
        notify.info(t('msg_wiki_page_already_restored', { target: page.title }))
      } else {
        notify.success(t('msg_restored_target', { target: page.title }))
      }
    })
  }

  const restoreWithDescendants = (page: DeletedPage, descendants: readonly DeletedPage[]) => {
    const parent = deletedParentOf(page)
    const text = [
      t('msg_confirm_restore_wiki_page_with_descendants', { target: page.title, count: descendants.length }),
      parent ? t('msg_wiki_restore_parent_still_deleted', { target: page.title, parent: parent.title }) : '',
    ].join('')
    return confirmAction({ title: t('wiki_restore_with_descendants_hint'), text }, async () => {
      const result = await restorePage(page, descendants)
      if (result.result === 'unchanged') {
        notify.info(t('msg_wiki_page_already_restored', { target: page.title }))
      } else {
        notify.success(t('msg_restored_wiki_page_with_descendants', { target: page.title, count: result.restored }))
      }
    })
  }

  const open = (number: number) => {
    state.close()
    router.push(wikiPagePath({ key: space.key, number: number }))
  }

  const parentLabel = (page: DeletedPage) => {
    const parent = page.parent
    switch (parent.state) {
      case 'root':
        return t('wiki_deleted_parent_root')
      case 'alive':
        return t('wiki_deleted_parent', { path: parent.path.join(' › ') })
      case 'deleted':
        return t('wiki_deleted_parent', { path: parent.title })
    }
  }

  return (
    <DialogModal state={state} size='2xl' isDismissable title={{ text: t('wiki_deleted_pages'), icon: <TrashIcon /> }}>
      {isLoading ? (
        <PanelSkeleton />
      ) : (
        <div className='space-y-3'>
          <p className='text-muted text-xs'>{t('msg_wiki_deleted_pages_hint', { days: data?.retentionDays ?? '-' })}</p>
          {pages.length === 0 ? (
            <div className='text-muted text-sm'>{t('msg_no_deleted_wiki_pages')}</div>
          ) : (
            <ul className='space-y-1'>
              {pages.map((page, index) => {
                const isRestored = restored.has(page.id)
                const descendants = restorableDescendantsAt(pages, index, restored)
                return (
                  <li key={page.id} className={row({ indent: indentOf(page.depth) })}>
                    <div className={rowBody({ isRestored })}>
                      <div className='flex min-w-0 items-center gap-2'>
                        <span className='truncate text-sm font-medium' title={page.title}>
                          {page.title}
                        </span>
                        <span className='text-muted shrink-0 font-mono text-xs'>{page.ref}</span>
                      </div>
                      {page.depth === 0 && !isFlat && (
                        <div className='text-muted truncate text-xs' title={parentLabel(page)}>
                          {parentLabel(page)}
                        </div>
                      )}
                      <UpdatedBy
                        name={page.deletedByName}
                        isAgent={page.deletedByIsAgent}
                        via={page.via}
                        at={page.deletedAt}
                      />
                    </div>
                    {isRestored ? (
                      <MultiButton
                        isIconOnly
                        size='sm'
                        variant='ghost'
                        tooltip={t('wiki_open_restored_page')}
                        icon={<ArrowTopRightOnSquareIcon width={16} />}
                        onPress={() => open(page.number)}
                      />
                    ) : (
                      access.canWrite && (
                        <div className='flex shrink-0 items-center gap-1'>
                          {descendants.length > 0 && (
                            <MultiButton
                              size='sm'
                              variant='ghost'
                              tooltip={t('wiki_restore_with_descendants_hint')}
                              icon={<ArrowUturnLeftIcon width={16} />}
                              isDisabled={isRestoring}
                              onPress={() => restoreWithDescendants(page, descendants)}
                            >
                              {t('wiki_restore_with_descendants')}
                            </MultiButton>
                          )}
                          <MultiButton
                            isIconOnly
                            size='sm'
                            variant='ghost'
                            tooltip={t('restore')}
                            icon={<ArrowUturnLeftIcon width={16} />}
                            isDisabled={isRestoring}
                            onPress={() => restore(page)}
                          />
                        </div>
                      )
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </DialogModal>
  )
}
