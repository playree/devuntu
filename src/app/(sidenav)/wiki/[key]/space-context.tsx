'use client'

import { PanelSkeleton } from '@/components/general/panel'
import { SideNavPortal } from '@/components/general/side-nav-slot'
import { BookOpenIcon } from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Spinner } from '@heroui/react'
import { createContext, FC, ReactNode, useContext, useMemo } from 'react'
import { WikiSideSpaces } from '../side-spaces'
import { getWikiSpace, GetWikiSpaceReturnType } from './server'
import { WikiSideTree } from './side-tree'

type WikiSpaceData = NonNullable<GetWikiSpaceReturnType>

type WikiTag = WikiSpaceData['tags'][number]

export type WikiSpaceContextValue = WikiSpaceData & {
  /** ツリーと権限を取り直す。ページの作成・移動・削除・改名の後に呼ぶ */
  reloadSpace: () => Promise<void>
  /** ツリーの項目が持つタグ ID を、表示順のタグに引き当てる */
  tagsOf: (tagIds: readonly string[]) => WikiTag[]
}

const WikiSpaceContext = createContext<WikiSpaceContextValue | null>(null)

/** スペース内の画面で、スペースの情報・権限・ツリーを使う */
export const useWikiSpace = (): WikiSpaceContextValue => {
  const value = useContext(WikiSpaceContext)
  if (!value) {
    throw new Error('useWikiSpace must be used inside WikiSpaceShell')
  }
  return value
}

/**
 * スペース内の画面の外枠。スペースとツリーを 1 度だけ取得し、ツリーはサイドメニューへ差し込む。
 * レイアウトに置くので、スペース内でページを移ってもツリーの開閉状態が残る
 */
export const WikiSpaceShell: FC<{ spaceKey: string; children: ReactNode }> = ({ spaceKey, children }) => {
  const { t } = useLocale()
  const { data, refresh, isLoading } = useActionData(() => getWikiSpace({ key: spaceKey }), { key: spaceKey })
  // 利用者(ツリー・本文・設定)を、取り直したとき以外に描き直さない
  const value = useMemo(() => {
    if (!data) {
      return null
    }
    const tagsOf = (ids: readonly string[]) => data.tags.filter((tag) => ids.includes(tag.id))
    return { ...data, reloadSpace: refresh, tagsOf }
  }, [data, refresh])

  // 読み込み中・閲覧できないときも差し込みは外さない(外すとタブが消え、出し直しで再びスライドする)
  if (isLoading) {
    return (
      <>
        <SideNavPortal label={t('wiki')}>
          <div className='flex justify-center py-4'>
            <Spinner size='lg' />
          </div>
        </SideNavPortal>
        <PanelSkeleton />
      </>
    )
  }
  if (!value) {
    return (
      <>
        <SideNavPortal label={t('wiki')}>
          <WikiSideSpaces />
        </SideNavPortal>
        <NoAccessView icon={<BookOpenIcon />} title={t('wiki')} backHref='/wiki' />
      </>
    )
  }

  return (
    <WikiSpaceContext.Provider value={value}>
      <SideNavPortal label={t('wiki')}>{value.access.canView ? <WikiSideTree /> : <WikiSideSpaces />}</SideNavPortal>
      {children}
    </WikiSpaceContext.Provider>
  )
}
