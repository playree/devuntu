'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowRightCircleIcon, BookOpenIcon, ClockIcon, DocumentPlusIcon, TrashIcon } from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { ReloadButton } from '@/components/reload-button'
import { useActionData } from '@/lib/action/action-client'
import { wikiPageRef } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { Breadcrumbs, ButtonGroup } from '@heroui/react'
import { FC } from 'react'
import { tv } from 'tailwind-variants'
import { ChildPages } from '../child-pages'
import { WikiPageHistoryModal, type WikiHistoryTarget } from '../page-history'
import { CreatePageModal, MovePageModal, useDeleteWikiPage } from '../page-modals'
import { useWikiSpace } from '../space-context'
import { WikiPageBody } from './page-body'
import { getWikiPage, GetWikiPageReturnType } from './server'

type PageDetail = NonNullable<GetWikiPageReturnType>

/**
 * HeroUI の項目は shrink-0 で、合計が溢れて隣のコピー欄へ重なるため、縮めて省略させる。
 * 中の <a> も flex item なので min-w-0 が要る
 */
const crumbItem = tv({
  base: 'shrink [&>a]:min-w-0 [&>svg]:shrink-0',
  variants: {
    kind: {
      space: 'min-w-16', // アイコンの分、先祖より広く残す
      ancestor: 'min-w-12', // 2文字程度の短い名前は省略しない
      current: 'max-w-[60%] shrink-0', // 少し縮めるだけで1文字省略されるため、縮めずに上限で抑えて先祖側を縮める
    },
    /** スマホ幅では親以外の先祖を省く(ツリーから辿れる) */
    isMiddle: { true: 'max-sm:hidden' },
  },
})

/** パンくず。スペース > 先祖 > このページ。長い名前は幅で省略する */
const WikiBreadcrumbs: FC<{ detail: PageDetail }> = ({ detail: { space, ancestors, page } }) => (
  <Breadcrumbs // 縮めきっても収まらないときは、現在のページ側を残して先頭(スペース側)を切る
    className='min-w-0 justify-end overflow-hidden'
  >
    <Breadcrumbs.Item href={`/wiki/${space.key}`} className={crumbItem({ kind: 'space' })}>
      <span className='flex min-w-0 items-center gap-1'>
        <BookOpenIcon width={16} className='shrink-0' />
        <span className='max-w-32 truncate sm:max-w-48'>{space.name}</span>
      </span>
    </Breadcrumbs.Item>
    {ancestors.map((ancestor, index) => (
      <Breadcrumbs.Item
        key={ancestor.number}
        href={`/wiki/${space.key}/${ancestor.number}`}
        className={crumbItem({ kind: 'ancestor', isMiddle: index < ancestors.length - 1 })}
      >
        <span className='block max-w-24 truncate sm:max-w-40'>{ancestor.title}</span>
      </Breadcrumbs.Item>
    ))}
    <Breadcrumbs.Item
      href={`/wiki/${space.key}/${page.number}`}
      className={crumbItem({ kind: 'current' })}
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
  const historyState = useModalState<WikiHistoryTarget>()
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
        <MultiButton
          isIconOnly
          tooltip={t('history')}
          icon={<ClockIcon />}
          onPress={() => historyState.open({ pageId: page.id, title: page.title })}
        >
          {access.canWrite && <ButtonGroup.Separator />}
        </MultiButton>
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
          hasSeparator
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
      <WikiPageHistoryModal
        key={historyState.key}
        state={historyState}
        canWrite={access.canWrite}
        onRestored={reloadAll}
      />
    </FlexCol>
  )
}
