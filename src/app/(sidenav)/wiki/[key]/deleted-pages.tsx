'use client'

import { MultiButton } from '@/components/general/button'
import { DialogModal, useModalState } from '@/components/general/modal'
import { PanelSkeleton } from '@/components/general/panel'
import { ArrowUturnLeftIcon, ClockIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { UpdatedBy } from '@/components/updated-by'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { WikiPageHistoryModal, type WikiHistoryTarget } from './page-history'
import { getDeletedWikiPages, restoreWikiPageRevision, type GetDeletedWikiPagesReturnType } from './server'
import { useWikiSpace } from './space-context'

type DeletedPage = NonNullable<GetDeletedWikiPagesReturnType>['pages'][number]

/**
 * 削除済みのページの一覧。最後の削除の版から1ページずつ復元でき、履歴で削除前の内容を確かめられる。
 * 復元したらそのページへ移る
 */
export const DeletedPagesModal: FC<{ state: ReturnType<typeof useModalState<string>> }> = ({ state }) => {
  const { t } = useLocale()
  const router = useRouter()
  const confirmAction = useConfirmAction()
  const { space, access, reloadSpace } = useWikiSpace()
  const historyState = useModalState<WikiHistoryTarget>()
  const { data, isLoading } = useActionData(() => getDeletedWikiPages({ id: space.id }), {
    skip: !state.isOpen,
    key: `${space.id}_${state.isOpen}`,
  })

  const afterRestored = async (number: number) => {
    historyState.close()
    state.close()
    await reloadSpace()
    router.push(`/wiki/${space.key}/${number}`)
  }

  const restore = (page: DeletedPage) =>
    confirmAction(
      { title: t('restore'), text: t('msg_confirm_restore_deleted_wiki_page', { target: page.title }) },
      async () => {
        const result = await parseAction(restoreWikiPageRevision({ id: page.id }))
        notify.success(t('msg_restored_target', { target: page.title }))
        await afterRestored(result.number)
      },
    )

  const pages = data?.pages ?? []

  return (
    <>
      <DialogModal
        state={state}
        size='2xl'
        isDismissable
        title={{ text: t('wiki_deleted_pages'), icon: <TrashIcon /> }}
      >
        {isLoading ? (
          <PanelSkeleton />
        ) : (
          <div className='space-y-3'>
            <p className='text-muted text-xs'>
              {t('msg_wiki_deleted_pages_hint', { days: data?.retentionDays ?? '-' })}
            </p>
            {pages.length === 0 ? (
              <div className='text-muted text-sm'>{t('msg_no_deleted_wiki_pages')}</div>
            ) : (
              <ul className='space-y-1'>
                {pages.map((page) => (
                  <li key={page.id} className='border-border flex items-center gap-2 rounded-lg border px-2 py-1'>
                    <div className='min-w-0 flex-1 space-y-0.5'>
                      <div className='flex min-w-0 items-center gap-2'>
                        <span className='truncate text-sm font-medium' title={page.title}>
                          {page.title}
                        </span>
                        <span className='text-muted shrink-0 font-mono text-xs'>{page.ref}</span>
                      </div>
                      <UpdatedBy name={page.actorName} isAgent={page.actorIsAgent} via={page.via} at={page.updatedAt} />
                    </div>
                    <div className='flex shrink-0 items-center gap-0.5'>
                      <MultiButton
                        isIconOnly
                        size='sm'
                        variant='ghost'
                        tooltip={t('history')}
                        icon={<ClockIcon width={16} />}
                        onPress={() => historyState.open({ pageId: page.pageId, title: page.title })}
                      />
                      {access.canWrite && (
                        <MultiButton
                          isIconOnly
                          size='sm'
                          variant='ghost'
                          tooltip={t('restore')}
                          icon={<ArrowUturnLeftIcon width={16} />}
                          onPress={() => restore(page)}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogModal>
      <WikiPageHistoryModal
        key={historyState.key}
        state={historyState}
        canWrite={access.canWrite}
        onRestored={({ number }) => afterRestored(number)}
      />
    </>
  )
}
