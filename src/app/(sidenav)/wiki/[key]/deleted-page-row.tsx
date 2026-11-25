import { MultiButton } from '@/components/general/button'
import { ArrowTopRightOnSquareIcon, ArrowUturnLeftIcon } from '@/components/icon'
import { UpdatedBy } from '@/components/updated-by'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { tv } from 'tailwind-variants'
import type { GetDeletedWikiPagesReturnType } from './server'

export type DeletedPage = NonNullable<GetDeletedWikiPagesReturnType>['pages'][number]

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

export const DeletedPageRow: FC<{
  page: DeletedPage
  parentLabel?: string
  canWrite: boolean
  isRestored: boolean
  isRestoring: boolean
  onOpen: () => void
  onRestore: () => void
  onRestoreDescendants?: () => void
}> = ({ page, parentLabel, canWrite, isRestored, isRestoring, onOpen, onRestore, onRestoreDescendants }) => {
  const { t } = useLocale()
  return (
    <li className={row({ indent: indentOf(page.depth) })}>
      <div className={rowBody({ isRestored })}>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-sm font-medium' title={page.title}>
            {page.title}
          </span>
          <span className='text-muted shrink-0 font-mono text-xs'>{page.ref}</span>
        </div>
        {parentLabel && (
          <div className='text-muted truncate text-xs' title={parentLabel}>
            {parentLabel}
          </div>
        )}
        <UpdatedBy name={page.deletedByName} isAgent={page.deletedByIsAgent} via={page.via} at={page.deletedAt} />
      </div>
      {isRestored ? (
        <MultiButton
          isIconOnly
          size='sm'
          variant='ghost'
          tooltip={t('wiki_open_restored_page')}
          icon={<ArrowTopRightOnSquareIcon width={16} />}
          onPress={onOpen}
        />
      ) : (
        canWrite && (
          <div className='flex shrink-0 items-center gap-1'>
            {onRestoreDescendants && (
              <MultiButton
                size='sm'
                variant='ghost'
                tooltip={t('wiki_restore_with_descendants_hint')}
                icon={<ArrowUturnLeftIcon width={16} />}
                isDisabled={isRestoring}
                onPress={onRestoreDescendants}
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
              onPress={onRestore}
            />
          </div>
        )
      )}
    </li>
  )
}
