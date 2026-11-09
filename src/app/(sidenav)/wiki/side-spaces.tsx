'use client'

import { useSideNav } from '@/components/general/side-nav-slot'
import { BookOpenIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Spinner } from '@heroui/react'
import { FC } from 'react'
import { MenuButton } from '../menu'
import { getWikiSpaces } from './server'

/** サイドメニューに差し込むスペースの一覧。スペースの外(一覧・閲覧できないスペース)で出す */
export const WikiSideSpaces: FC = () => {
  const { t } = useLocale()
  const { closeMenu } = useSideNav()
  const { data, isLoading } = useActionData(() => getWikiSpaces({ includeArchived: false }))

  return (
    <div className='flex flex-col gap-1 px-2 pb-2'>
      <div // 見出し。スペース内のツリーの見出し(スペース名)と同じ位置・見た目にそろえる
        className='bg-accent-soft text-accent-soft-foreground flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold'
      >
        <BookOpenIcon width={16} className='shrink-0' />
        <span className='truncate'>{t('wiki_all_spaces')}</span>
      </div>

      {isLoading ? (
        <div className='flex justify-center py-4'>
          <Spinner size='lg' />
        </div>
      ) : !data?.length ? (
        <p className='text-muted px-2 py-1 text-xs'>{t('msg_no_wiki_spaces')}</p>
      ) : (
        data.map((space) => (
          <MenuButton
            key={space.id}
            to={`/wiki/${space.key}`}
            text={space.name}
            icon={<BookOpenIcon />}
            closeMenu={closeMenu}
          />
        ))
      )}
    </div>
  )
}
