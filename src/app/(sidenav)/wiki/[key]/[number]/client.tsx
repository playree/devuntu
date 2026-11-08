'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowRightCircleIcon, BookOpenIcon, DocumentPlusIcon, TrashIcon } from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { ReloadButton } from '@/components/reload-button'
import { useActionData } from '@/lib/action/action-client'
import { wikiPageRef } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { Breadcrumbs, ButtonGroup } from '@heroui/react'
import { FC } from 'react'
import { ChildPages } from '../child-pages'
import { CreatePageModal, MovePageModal, useDeleteWikiPage } from '../page-modals'
import { useWikiSpace } from '../space-context'
import { WikiPageBody } from './page-body'
import { getWikiPage, GetWikiPageReturnType } from './server'

type PageDetail = NonNullable<GetWikiPageReturnType>

/** パンくず。スペース > 先祖 > このページ。長い名前は幅で省略する */
const WikiBreadcrumbs: FC<{ detail: PageDetail }> = ({ detail: { space, ancestors, page } }) => (
  <Breadcrumbs className='min-w-0'>
    <Breadcrumbs.Item href={`/wiki/${space.key}`}>
      <span className='flex items-center gap-1'>
        <BookOpenIcon width={16} />
        <span className='max-w-32 truncate sm:max-w-48'>{space.name}</span>
      </span>
    </Breadcrumbs.Item>
    {ancestors.map((ancestor) => (
      <Breadcrumbs.Item key={ancestor.number} href={`/wiki/${space.key}/${ancestor.number}`}>
        <span className='block max-w-24 truncate sm:max-w-40'>{ancestor.title}</span>
      </Breadcrumbs.Item>
    ))}
    <Breadcrumbs.Item
      href={`/wiki/${space.key}/${page.number}`}
      isDisabled={false} // react-aria は最後の項目を現在地として無効化するため、明示的に打ち消してリンクにする
    >
      <span className='block max-w-40 truncate sm:max-w-72'>{page.title}</span>
    </Breadcrumbs.Item>
  </Breadcrumbs>
)

/** ページ詳細。本文の表示・編集と、子ページの作成・移動・削除 */
export const WikiPageClient: FC<{ spaceKey: string; number: number }> = ({ spaceKey, number }) => {
  const { t } = useLocale()
  const { reloadSpace } = useWikiSpace()
  const createModalState = useModalState()
  const moveModalState = useModalState()
  const deletePage = useDeleteWikiPage()
  const isValidNumber = Number.isInteger(number) && number > 0
  const { data, refresh, isLoading } = useActionData(() => getWikiPage({ key: spaceKey, number }), {
    key: `${spaceKey}/${number}`,
    skip: !isValidNumber,
  })

  if (isLoading) {
    return <PanelSkeleton />
  }
  if (!data) {
    return <NoAccessView icon={<BookOpenIcon />} title={t('wiki')} backHref={`/wiki/${spaceKey}`} />
  }

  const { space, access, page, ancestors } = data
  const parentHref = ancestors.length > 0 ? `/wiki/${space.key}/${ancestors.at(-1)?.number}` : `/wiki/${space.key}`
  // 本文の保存・移動・作成の後は、ツリー(タイトル・並び)も取り直す
  const reloadAll = async () => {
    await Promise.all([refresh(), reloadSpace()])
  }

  return (
    <FlexCol>
      <ContentHeader
        title={
          <>
            <WikiBreadcrumbs detail={data} />
            <CopyableField // `KEY/番号` は改名・移動で変わらないので、AI やチケットからの参照に使える
              className='w-28 shrink-0'
              isSmart
              text={wikiPageRef({ key: space.key, number: page.number })}
              aria-label={t('wiki_page_ref')}
            />
          </>
        }
      >
        {access.canWrite && (
          <MultiButton
            isIconOnly
            tooltip={t('wiki_add_child_page')}
            icon={<DocumentPlusIcon />}
            onPress={() => createModalState.open()}
          />
        )}
        {access.canWrite && (
          <MultiButton
            isIconOnly
            tooltip={t('wiki_move_page')}
            icon={<ArrowRightCircleIcon />}
            onPress={() => moveModalState.open()}
          >
            <ButtonGroup.Separator />
          </MultiButton>
        )}
        {access.canWrite && (
          <MultiButton
            isIconOnly
            tooltip={t('delete')}
            icon={<TrashIcon />}
            onPress={() => deletePage(page, parentHref)}
          >
            <ButtonGroup.Separator />
          </MultiButton>
        )}
        <ReloadButton // 編集中の下書きを消さないよう、画面を作り直さずに取り直す
          onReload={reloadAll}
          hasSeparator={access.canWrite}
        />
      </ContentHeader>

      {space.archived && <NoticePanel status='warning'>{t('msg_wiki_space_archived')}</NoticePanel>}

      <WikiPageBody key={page.id} page={page} canWrite={access.canWrite} onSaved={reloadAll} />

      <ChildPages parentId={page.id} />

      <CreatePageModal
        state={createModalState}
        reload={reloadSpace}
        key={createModalState.key}
        parent={{ id: page.id, title: page.title }}
      />
      <MovePageModal state={moveModalState} reload={reloadAll} key={moveModalState.key} page={page} />
    </FlexCol>
  )
}
