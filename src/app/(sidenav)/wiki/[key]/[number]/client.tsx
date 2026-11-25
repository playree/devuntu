'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { BookOpenIcon, DocumentPlusIcon, FolderArrowRightIcon, MegaphoneIcon, TrashIcon } from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { ReloadButton } from '@/components/reload-button'
import { useActionData } from '@/lib/action/action-client'
import { canSeeWikiAnnounce } from '@/lib/wiki/wiki-announcement-notify-rule'
import {
  canDeleteWikiRevision,
  isFlatWikiSpace,
  wikiPagePath,
  wikiPageRef,
  wikiSpacePath,
  wikiSpaceTypeSpec,
} from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { Breadcrumbs, ButtonGroup } from '@heroui/react'
import { FC } from 'react'
import { tv } from 'tailwind-variants'
import { ChildPages } from '../child-pages'
import { CreatePageModal } from '../create-page-modal'
import { MovePageModal } from '../move-page-modal'
import { useWikiSpace } from '../space-context'
import { useDeleteWikiPage } from '../use-delete-wiki-page'
import { WikiAnnounceHistory } from './page-announce-history'
import { WikiAnnounceModal, type WikiAnnounceItem } from './page-announce-modal'
import { WikiPageBody } from './page-body'
import { getWikiAnnouncementNotifies, getWikiPage, GetWikiPageReturnType } from './server'

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
    <Breadcrumbs.Item href={wikiSpacePath(space.key)} className={crumbItem({ kind: 'space' })}>
      <span className='flex min-w-0 items-center gap-1'>
        <BookOpenIcon width={16} className='shrink-0' />
        <span className='max-w-32 truncate sm:max-w-48'>{space.name}</span>
      </span>
    </Breadcrumbs.Item>
    {ancestors.map((ancestor, index) => (
      <Breadcrumbs.Item
        key={ancestor.number}
        href={wikiPagePath({ key: space.key, number: ancestor.number })}
        className={crumbItem({ kind: 'ancestor', isMiddle: index < ancestors.length - 1 })}
      >
        <span className='block max-w-24 truncate sm:max-w-40'>{ancestor.title}</span>
      </Breadcrumbs.Item>
    ))}
    <Breadcrumbs.Item
      href={wikiPagePath({ key: space.key, number: page.number })}
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
  const announceModalState = useModalState<WikiAnnounceItem>()
  const deletePage = useDeleteWikiPage()
  const isValidNumber = Number.isInteger(number) && number > 0
  const { data, refresh, isLoading } = useActionData(() => getWikiPage({ key: spaceKey, number }), {
    key: `${spaceKey}/${number}`,
    skip: !isValidNumber,
  })
  // アナウンスの Slack 通知の履歴。送る側(editor 以上)にだけ出す
  const pageId = data?.page.id
  const canSeeAnnounce = !!data && wikiSpaceTypeSpec(data.space.type).announce && canSeeWikiAnnounce(data.access.role)
  const { data: announce, refresh: refreshAnnounce } = useActionData(
    () => getWikiAnnouncementNotifies({ id: pageId ?? '' }),
    { skip: !canSeeAnnounce, key: pageId },
  )

  if (isLoading) {
    return <PanelSkeleton />
  }
  if (!data) {
    return <NoAccessView icon={<BookOpenIcon />} title={t('wiki')} backHref={wikiSpacePath(spaceKey)} />
  }

  const { space, access, page, ancestors } = data
  // アナウンス用スペースは平らで、並びは作成日時で決まるので、子ページの作成と移動を出さない
  const isFlat = isFlatWikiSpace(space.type)
  const parent = ancestors.at(-1)
  const parentHref = parent ? wikiPagePath({ key: space.key, number: parent.number }) : wikiSpacePath(space.key)
  // 本文の保存・移動・作成の後は、ツリー(タイトル・並び)も取り直す
  const reloadAll = async () => {
    await Promise.all([refresh(), reloadSpace(), ...(canSeeAnnounce ? [refreshAnnounce()] : [])])
  }
  // 通知の状態はサイドバーと一覧のバッジにも出るので、スペースも取り直す
  const reloadAnnounce = () => {
    refreshAnnounce()
    reloadSpace()
  }
  const showAnnounceButton = canSeeAnnounce && access.canWrite

  return (
    <FlexCol>
      <FlexCol // 設計書の表示中は画面 1 枚分(#side-main の p-4 を除く)の高さを持ち、本文が下端まで伸びる。子ページはその下
        className='has-data-fill-screen:min-h-[calc(100dvh-2rem)]'
      >
        <ContentHeader
          isTitleWide
          title={
            <>
              <WikiBreadcrumbs detail={data} />
              <CopyableField // `KEY/番号` は改名・移動で変わらないので、AI やチケットからの参照に使える
                className='shrink-0'
                isSmart
                isFitContent
                text={wikiPageRef({ key: space.key, number: page.number })}
                aria-label={t('wiki_page_ref')}
              />
            </>
          }
        >
          {access.canWrite && !isFlat && (
            <MultiButton
              isIconOnly
              tooltip={t('wiki_add_child_page')}
              icon={<DocumentPlusIcon />}
              onPress={() => createModalState.open()}
            />
          )}
          {access.canWrite && !isFlat && (
            <MultiButton
              isIconOnly
              tooltip={t('wiki_move_page')}
              icon={<FolderArrowRightIcon />}
              onPress={() => moveModalState.open()}
            >
              <ButtonGroup.Separator />
            </MultiButton>
          )}
          {showAnnounceButton && (
            <MultiButton
              isIconOnly
              tooltip={t('wiki_announce')}
              icon={<MegaphoneIcon />}
              isDisabled={!announce}
              onPress={() => announceModalState.open()}
            />
          )}
          {access.canWrite && (
            <MultiButton
              isIconOnly
              tooltip={t('wiki_delete_page')}
              icon={<TrashIcon />}
              onPress={() => deletePage(page, parentHref, reloadAll)}
            >
              {(!isFlat || showAnnounceButton) && <ButtonGroup.Separator />}
            </MultiButton>
          )}
          <ReloadButton // 編集中の下書きを消さないよう、画面を作り直さずに取り直す
            onReload={reloadAll}
            hasSeparator={access.canWrite}
          />
        </ContentHeader>

        {space.archived && <NoticePanel status='warning'>{t('msg_wiki_space_archived')}</NoticePanel>}

        <WikiPageBody
          key={page.id}
          page={page}
          canWrite={access.canWrite}
          canDeleteRevision={canDeleteWikiRevision(access)}
          onSaved={reloadAll}
        />
      </FlexCol>

      <ChildPages parentId={page.id} />

      {canSeeAnnounce && announce && (
        <WikiAnnounceHistory
          items={announce.items}
          canWrite={announce.canWrite}
          onEdit={(item) => announceModalState.open(item)}
          reload={reloadAnnounce}
        />
      )}

      <CreatePageModal
        state={createModalState}
        reload={reloadSpace}
        key={createModalState.key}
        parent={{ id: page.id, title: page.title }}
      />
      <MovePageModal state={moveModalState} reload={reloadAll} key={moveModalState.key} page={page} />
      {announce && (
        <WikiAnnounceModal
          state={announceModalState}
          reload={reloadAnnounce}
          key={announceModalState.key}
          pageId={page.id}
          // 初回を送った後は、修正のお知らせを既定にする
          defaultKind={announce.items.some((item) => item.status === 'sent') ? 'updated' : 'published'}
          available={announce.available}
          target={announceModalState.target}
        />
      )}
    </FlexCol>
  )
}
