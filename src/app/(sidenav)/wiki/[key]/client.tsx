'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { Cog6ToothIcon, DocumentPlusIcon, TrashIcon } from '@/components/icon'
import { ReloadButton } from '@/components/reload-button'
import { WikiRoleChip, WikiSpaceTypeChip, WikiSpaceTypeIcon, WikiVisibilityChip } from '@/components/wiki-chip'
import { type WikiAnnouncementFilter } from '@/lib/wiki/wiki-announcement-rule'
import { wikiSettingsPath, wikiSpaceTypeSpec } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { ButtonGroup } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { WikiAnnouncementIndex } from './announcement-index'
import { ChildPages } from './child-pages'
import { CreatePageModal } from './create-page-modal'
import { DeletedPagesModal } from './deleted-pages'
import { WikiDesignDocIndex } from './design-doc-index'
import { useWikiSpace } from './space-context'

/** スペースのトップ。説明とスペース直下のページ(設計書スペースでは設計書一覧、アナウンス用スペースでは新しい順の一覧とバックナンバー) */
export const WikiSpaceTopClient: FC<{ announcementFilter: WikiAnnouncementFilter }> = ({ announcementFilter }) => {
  const { t } = useLocale()
  const router = useRouter()
  const { space, access, tree, reloadSpace } = useWikiSpace()
  const spec = wikiSpaceTypeSpec(space.type)
  const createModalState = useModalState()
  const deletedModalState = useModalState()

  return (
    <FlexCol>
      <ContentHeader
        icon={<WikiSpaceTypeIcon type={space.type} />}
        title={<span className='truncate'>{space.name}</span>}
      >
        {access.canWrite && (
          <MultiButton
            isIconOnly
            tooltip={spec.announce ? t('wiki_new_announcement') : t('wiki_add_page')}
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
            onPress={() => router.push(wikiSettingsPath(space.key))}
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
        <WikiSpaceTypeChip value={space.type} />
        {access.role && <WikiRoleChip value={access.role} />}
      </div>
      {space.description && <p className='text-sm whitespace-pre-wrap'>{space.description}</p>}

      {!access.canView ? (
        <NoticePanel>{t('msg_wiki_manage_only')}</NoticePanel>
      ) : spec.index === 'design_doc' ? (
        <WikiDesignDocIndex />
      ) : spec.index === 'announcement' ? (
        <>
          {access.canWrite && (
            <MultiButton
              size='sm'
              className='self-start'
              icon={<DocumentPlusIcon />}
              onPress={() => createModalState.open()}
            >
              {t('wiki_new_announcement')}
            </MultiButton>
          )}
          <WikiAnnouncementIndex filter={announcementFilter} />
        </>
      ) : tree.length === 0 ? (
        <div className='flex flex-col items-start gap-2'>
          <p className='text-muted text-sm'>{t('msg_no_wiki_pages')}</p>
          {access.canWrite && (
            <MultiButton size='sm' icon={<DocumentPlusIcon />} onPress={() => createModalState.open()}>
              {t('wiki_add_page')}
            </MultiButton>
          )}
        </div>
      ) : (
        <ChildPages parentId={null} />
      )}

      <CreatePageModal state={createModalState} reload={reloadSpace} key={createModalState.key} parent={null} />
      {access.canView && <DeletedPagesModal state={deletedModalState} key={deletedModalState.key} />}
    </FlexCol>
  )
}
