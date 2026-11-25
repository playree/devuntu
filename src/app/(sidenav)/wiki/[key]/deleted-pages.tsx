'use client'

import { DialogModal, useModalState } from '@/components/general/modal'
import { PanelSkeleton } from '@/components/general/panel'
import { TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { isFlatWikiSpace, WIKI_TREE_CHANGED, wikiPagePath } from '@/lib/wiki/wiki-rule'
import { restorableDescendantsAt } from '@/lib/wiki/wiki-tree'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'
import { DeletedPageRow, type DeletedPage } from './deleted-page-row'
import { getDeletedWikiPages, restoreDeletedWikiPage } from './server'
import { useWikiSpace } from './space-context'

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
      const descendantIds = descendants.map(({ id }) => id)
      const result = await parseAction(restoreDeletedWikiPage({ id: page.id, descendantIds }))
      setRestored((prev) => new Set([...prev, page.id, ...descendantIds]))
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
                  <DeletedPageRow
                    key={page.id}
                    page={page}
                    parentLabel={page.depth === 0 && !isFlat ? parentLabel(page) : undefined}
                    canWrite={access.canWrite}
                    isRestored={isRestored}
                    isRestoring={isRestoring}
                    onOpen={() => open(page.number)}
                    onRestore={() => restore(page)}
                    onRestoreDescendants={
                      descendants.length ? () => restoreWithDescendants(page, descendants) : undefined
                    }
                  />
                )
              })}
            </ul>
          )}
        </div>
      )}
    </DialogModal>
  )
}
