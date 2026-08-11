'use client'

import { MultiButton } from '@/components/general/button'
import { useConfirmModal } from '@/components/general/modal'
import { ArchiveBoxIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { useBoardName } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action-client'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { FC, ReactNode } from 'react'
import { deleteBoard, GetBoardDetailReturnType, setBoardArchived } from './server'

type Board = NonNullable<GetBoardDetailReturnType>

/** 危険操作 1 件分の行。見出し + 説明 + 右寄せのボタン */
const DangerRow: FC<{ title: string; description: string; children: ReactNode }> = ({
  title,
  description,
  children,
}) => (
  <div className='flex flex-wrap items-center gap-2 py-3'>
    <div className='min-w-0 flex-1'>
      <div className='text-sm font-semibold'>{title}</div>
      <div className='text-xs text-gray-500'>{description}</div>
    </div>
    {children}
  </div>
)

/**
 * アーカイブ / 削除をまとめたセクション。
 * 誤操作を防ぐため、どちらもチェック必須の確認モーダルを通す。
 */
export const DangerZone: FC<{ board: Board; reload: () => void }> = ({ board, reload }) => {
  const { t } = useLocale()
  const router = useRouter()
  const boardName = useBoardName()
  const { confirmModal } = useConfirmModal()

  const toggleArchive = async () => {
    const name = boardName(board)
    const next = !board.archived
    try {
      const ok = await confirmModal().confirm({
        title: t('confirm_archive'),
        text: next
          ? t('msg_confirm_archive_board', { target: name })
          : t('msg_confirm_unarchive_board', { target: name }),
        requireCheck: true,
        autoClose: false,
      })
      if (ok) {
        await parseAction(setBoardArchived({ id: board.id, archived: next }))
        notify.success(t('msg_saved'))
        reload()
      }
    } finally {
      confirmModal().close()
    }
  }

  // ボード削除は配下のチケット / コメントごと消えるので、ボード名入りの専用確認文をチェック付きで出す
  const removeBoard = async () => {
    const name = boardName(board)
    try {
      const ok = await confirmModal().confirm({
        title: t('confirm_deletion'),
        text: t('msg_confirm_delete_board', { target: name }),
        requireCheck: true,
        autoClose: false,
      })
      if (ok) {
        await parseAction(deleteBoard({ id: board.id }))
        notify.success(t('msg_deleted_target', { target: name }))
        router.push('/boards')
      }
    } finally {
      confirmModal().close()
    }
  }

  return (
    <div className='divide-y'>
      <DangerRow title={t('archived')} description={t('msg_archive_board')}>
        <MultiButton size='sm' variant='danger-soft' icon={<ArchiveBoxIcon />} onPress={toggleArchive}>
          {board.archived ? t('unarchive') : t('archive')}
        </MultiButton>
      </DangerRow>
      <DangerRow title={t('delete_board')} description={t('msg_delete_board')}>
        <MultiButton size='sm' variant='danger-soft' icon={<TrashIcon />} onPress={removeBoard}>
          {t('delete')}
        </MultiButton>
      </DangerRow>
    </div>
  )
}
