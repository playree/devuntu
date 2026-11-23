'use client'

import { MultiButton } from '@/components/general/button'
import { DialogModal, useModalState } from '@/components/general/modal'
import { PanelSkeleton } from '@/components/general/panel'
import { ArrowTopRightOnSquareIcon, ArrowUturnLeftIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { UpdatedBy } from '@/components/updated-by'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { isWikiPageTypeAllowed } from '@/lib/wiki/wiki-rule'
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

/** 一覧の `index` の行の配下(一覧で後に続く、段の深い行) */
const descendantsAt = (pages: readonly DeletedPage[], index: number): DeletedPage[] => {
  const depth = pages[index].depth
  let end = index + 1
  while (end < pages.length && pages[end].depth > depth) {
    end++
  }
  return pages.slice(index + 1, end)
}

/**
 * 削除済みのページの一覧。最後の削除の版から復元できる(削除前の内容は、復元したページの履歴で確かめられる)。
 * 一覧は元の親 → 子の順で、上から順に復元すれば元の親子関係に戻る。
 * 復元してもモーダルは閉じず、開き直すまで一覧は取り直さない。復元した行はページを開くボタンに替える
 */
export const DeletedPagesModal: FC<{ state: ReturnType<typeof useModalState<string>> }> = ({ state }) => {
  const { t } = useLocale()
  const router = useRouter()
  const confirmAction = useConfirmAction()
  const { space, access, reloadSpace } = useWikiSpace()
  const { data, isLoading } = useActionData(() => getDeletedWikiPages({ id: space.id }), {
    skip: !state.isOpen,
    key: `${space.id}_${state.isOpen}`,
  })
  /** 復元したページ(pageId → 番号) */
  const [restored, setRestored] = useState<ReadonlyMap<string, number>>(new Map())
  const [isRestoring, setIsRestoring] = useState(false)

  const pages = data?.pages ?? []
  // 設計書スペースへ通常ページは戻せない(サーバーでも弾く)
  const canRestore = (page: DeletedPage) => isWikiPageTypeAllowed(space.type, page.type)

  /**
   * 1 ページずつ順に戻し、既に戻されていた(一覧を開いた後に別の人が戻した)ページの数を返す。
   * 既に戻されていたページは上書きせず、復元済みとして扱う。失敗したらそこで止まり、戻した分は復元済みのまま残る
   */
  const restorePages = async (targets: readonly DeletedPage[]): Promise<number> => {
    setIsRestoring(true)
    let existed = 0
    try {
      for (const page of targets) {
        const result = await parseAction(restoreDeletedWikiPage({ id: page.id }))
        if (result.result === 'unchanged') {
          existed++
        }
        setRestored((prev) => new Map(prev).set(page.pageId, result.number))
      }
      return existed
    } finally {
      setIsRestoring(false)
      await reloadSpace()
    }
  }

  /** 元の親が削除されたまま(この一覧で未復元)なら、その親 */
  const deletedParentOf = (page: DeletedPage) =>
    page.parent.state === 'deleted' && !restored.has(page.parent.pageId) ? page.parent : undefined

  const restore = (page: DeletedPage) => {
    const parent = deletedParentOf(page)
    const text = parent
      ? t('msg_confirm_restore_deleted_wiki_page_parent_deleted', { target: page.title, parent: parent.title })
      : t('msg_confirm_restore_deleted_wiki_page', { target: page.title })
    return confirmAction({ title: t('restore'), text }, async () => {
      if ((await restorePages([page])) > 0) {
        notify.info(t('msg_wiki_page_already_restored', { target: page.title }))
      } else {
        notify.success(t('msg_restored_target', { target: page.title }))
      }
    })
  }

  /**
   * 配下ごと戻す対象(一覧の順)と、戻さない未復元のページの数。
   * 戻せない種類のページは、その配下ごと飛ばす(親が無いと配下はスペース直下へ入るため)。
   * 復元済みのページは飛ばすが、その配下は対象にする
   */
  const restoreTargetsAt = (index: number): { targets: DeletedPage[]; excluded: number } => {
    const targets = [pages[index]]
    let excluded = 0
    let skipBelow: number | undefined
    for (const page of descendantsAt(pages, index)) {
      if (skipBelow !== undefined && page.depth > skipBelow) {
        excluded += restored.has(page.pageId) ? 0 : 1
        continue
      }
      skipBelow = undefined
      if (!canRestore(page)) {
        skipBelow = page.depth
        excluded++
      } else if (!restored.has(page.pageId)) {
        targets.push(page)
      }
    }
    return { targets, excluded }
  }

  const restoreWithDescendants = (page: DeletedPage, { targets, excluded }: ReturnType<typeof restoreTargetsAt>) => {
    const parent = deletedParentOf(page)
    const text = [
      t('msg_confirm_restore_wiki_page_with_descendants', { target: page.title, count: targets.length - 1 }),
      parent ? t('msg_wiki_restore_parent_still_deleted', { target: page.title, parent: parent.title }) : '',
      excluded > 0 ? t('msg_wiki_restore_excluded_pages', { count: excluded }) : '',
    ].join('')
    return confirmAction({ title: t('wiki_restore_with_descendants_hint'), text }, async () => {
      const existed = await restorePages(targets)
      notify.success(
        t('msg_restored_wiki_page_with_descendants', { target: page.title, count: targets.length - existed }),
      )
      if (existed > 0) {
        notify.info(t('msg_wiki_pages_already_restored', { count: existed }))
      }
    })
  }

  const open = (number: number) => {
    state.close()
    router.push(`/wiki/${space.key}/${number}`)
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
      case 'missing':
        return t('wiki_deleted_parent_missing')
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
                const restoredNumber = restored.get(page.pageId)
                const isRestored = restoredNumber !== undefined
                const plan = access.canWrite && !isRestored && canRestore(page) ? restoreTargetsAt(index) : undefined
                return (
                  <li key={page.id} className={row({ indent: indentOf(page.depth) })}>
                    <div className={rowBody({ isRestored })}>
                      <div className='flex min-w-0 items-center gap-2'>
                        <span className='truncate text-sm font-medium' title={page.title}>
                          {page.title}
                        </span>
                        <span className='text-muted shrink-0 font-mono text-xs'>{page.ref}</span>
                      </div>
                      {page.depth === 0 && (
                        <div className='text-muted truncate text-xs' title={parentLabel(page)}>
                          {parentLabel(page)}
                        </div>
                      )}
                      <UpdatedBy name={page.actorName} isAgent={page.actorIsAgent} via={page.via} at={page.updatedAt} />
                      {access.canWrite && !isRestored && !canRestore(page) && (
                        <div // 無効のボタンには tooltip が出ないので、押せない理由を行に出す
                          className='text-warning text-xs'
                        >
                          {t('msg_wiki_cannot_restore_regular_page')}
                        </div>
                      )}
                    </div>
                    {isRestored ? (
                      <MultiButton
                        isIconOnly
                        size='sm'
                        variant='ghost'
                        tooltip={t('wiki_open_restored_page')}
                        icon={<ArrowTopRightOnSquareIcon width={16} />}
                        onPress={() => open(restoredNumber)}
                      />
                    ) : (
                      access.canWrite && (
                        <div className='flex shrink-0 items-center gap-1'>
                          {plan && plan.targets.length > 1 && (
                            <MultiButton
                              size='sm'
                              variant='ghost'
                              tooltip={t('wiki_restore_with_descendants_hint')}
                              icon={<ArrowUturnLeftIcon width={16} />}
                              isDisabled={isRestoring}
                              onPress={() => restoreWithDescendants(page, plan)}
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
                            isDisabled={!canRestore(page) || isRestoring}
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
