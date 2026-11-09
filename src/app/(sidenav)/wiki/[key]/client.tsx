'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { BookOpenIcon, Cog6ToothIcon, DocumentPlusIcon, TrashIcon } from '@/components/icon'
import { ReloadButton } from '@/components/reload-button'
import { WikiRoleChip, WikiVisibilityChip } from '@/components/wiki-chip'
import { useLocale } from '@/locale/client'
import { ButtonGroup } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { ChildPages } from './child-pages'
import { DeletedPagesModal } from './deleted-pages'
import { CreatePageModal } from './page-modals'
import { useWikiSpace } from './space-context'

/** スペースのトップ。説明とスペース直下のページ */
export const WikiSpaceTopClient: FC = () => {
  const { t } = useLocale()
  const router = useRouter()
  const { space, access, tree, reloadSpace } = useWikiSpace()
  const createModalState = useModalState()
  const deletedModalState = useModalState()

  return (
    <FlexCol>
      <ContentHeader icon={<BookOpenIcon />} title={<span className='truncate'>{space.name}</span>}>
        {access.canWrite && (
          <MultiButton
            isIconOnly
            tooltip={t('wiki_add_page')}
            icon={<DocumentPlusIcon />}
            onPress={() => createModalState.open()}
          />
        )}
        {access.canView && (
          <MultiButton
            isIconOnly
            tooltip={t('wiki_deleted_pages')}
            icon={<TrashIcon />}
            onPress={() => deletedModalState.open()}
          >
            {access.canWrite && <ButtonGroup.Separator />}
          </MultiButton>
        )}
        {access.canManage && (
          <MultiButton
            isIconOnly
            tooltip={t('wiki_space_settings')}
            icon={<Cog6ToothIcon />}
            onPress={() => router.push(`/wiki/${space.key}/settings`)}
          >
            {access.canView && <ButtonGroup.Separator />}
          </MultiButton>
        )}
        <ReloadButton onReload={reloadSpace} hasSeparator={access.canView || access.canManage} />
      </ContentHeader>

      {space.archived && <NoticePanel status='warning'>{t('msg_wiki_space_archived')}</NoticePanel>}

      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <span className='text-muted font-mono text-xs'>{space.key}</span>
        <WikiVisibilityChip value={space.visibility} />
        {access.role && <WikiRoleChip value={access.role} />}
      </div>
      {space.description && <p className='text-sm whitespace-pre-wrap'>{space.description}</p>}

      {!access.canView ? (
        <NoticePanel>{t('msg_wiki_manage_only')}</NoticePanel>
      ) : tree.length === 0 ? (
        <p className='text-muted text-sm'>{t('msg_no_wiki_pages')}</p>
      ) : (
        <ChildPages parentId={null} />
      )}

      <CreatePageModal state={createModalState} reload={reloadSpace} key={createModalState.key} parent={null} />
      {access.canView && <DeletedPagesModal state={deletedModalState} key={deletedModalState.key} />}
    </FlexCol>
  )
}
