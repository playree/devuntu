'use client'

import { DangerRow } from '@/components/danger-row'
import { MultiButton } from '@/components/general/button'
import { ArchiveBoxIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { WIKI_TOP_PATH } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { type WikiSpaceContextValue } from '../space-context'
import { deleteWikiSpace, setWikiSpaceArchived } from './server'

type Space = WikiSpaceContextValue['space']

/**
 * アーカイブ / 削除をまとめたセクション。誤操作を防ぐため、どちらもチェック必須の確認モーダルを通す。
 * アーカイブ中は閲覧のみになるが、設定は変えられるので解除と削除もここで行う
 */
export const WikiSpaceDangerZone: FC<{ space: Space; reload: () => Promise<void> }> = ({ space, reload }) => {
  const { t } = useLocale()
  const router = useRouter()
  const confirmAction = useConfirmAction()

  const toggleArchive = async () => {
    const next = !space.archived
    await confirmAction(
      {
        title: next ? t('confirm_archive') : t('confirm_unarchive'),
        text: next
          ? t('msg_confirm_archive_wiki_space', { target: space.name })
          : t('msg_confirm_unarchive_wiki_space', { target: space.name }),
      },
      async () => {
        await parseAction(setWikiSpaceArchived({ id: space.id, archived: next }))
        notify.success(t('msg_saved'))
        await reload()
      },
    )
  }

  const removeSpace = async () => {
    await confirmAction(
      { title: t('confirm_deletion'), text: t('msg_confirm_delete_wiki_space', { target: space.name }) },
      async () => {
        await parseAction(deleteWikiSpace({ id: space.id }))
        notify.success(t('msg_deleted_target', { target: space.name }))
        router.push(WIKI_TOP_PATH)
      },
    )
  }

  return (
    <div className='divide-y'>
      <DangerRow title={t('archived')} description={t('msg_archive_wiki_space')}>
        <MultiButton size='sm' variant='danger-soft' icon={<ArchiveBoxIcon />} onPress={toggleArchive}>
          {space.archived ? t('unarchive') : t('archive')}
        </MultiButton>
      </DangerRow>
      <DangerRow title={t('delete_wiki_space')} description={t('msg_delete_wiki_space')}>
        <MultiButton size='sm' variant='danger-soft' icon={<TrashIcon />} onPress={removeSpace}>
          {t('delete')}
        </MultiButton>
      </DangerRow>
    </div>
  )
}
