'use client'

import { useSideNav } from '@/components/general/side-nav-slot'
import { BookOpenIcon, ChevronDownIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Button, cn, Dropdown, Label, Separator } from '@heroui/react'
import { usePathname, useRouter } from 'next/navigation'
import { FC, useMemo } from 'react'
import { getWikiSpaces } from '../server'
import { useWikiSpace } from './space-context'

/** スペースキーは英大文字始まりなので、小文字の値とは衝突しない */
const ALL_SPACES_KEY = 'all'

/** ツリーの見出し。スペース名を押すと、閲覧できるスペースの一覧から切り替えられる */
export const WikiSpaceSwitcher: FC = () => {
  const { t } = useLocale()
  const { space } = useWikiSpace()
  const { closeMenu } = useSideNav()
  const pathname = usePathname()
  const router = useRouter()
  const { data } = useActionData(() => getWikiSpaces({ includeArchived: false }))

  // アーカイブ済み・取得中でも、今のスペースは必ず選べるようにする
  const spaces = useMemo(() => {
    const list = (data ?? []).map(({ key, name }) => ({ key, name }))
    return list.some((s) => s.key === space.key) ? list : [{ key: space.key, name: space.name }, ...list]
  }, [data, space.key, space.name])
  const isTop = pathname === `/wiki/${space.key}`

  return (
    <Dropdown>
      <Button
        variant='ghost'
        size='sm'
        aria-label={`${space.name} - ${t('wiki_switch_space')}`}
        className={cn(
          'min-w-0 flex-1 justify-start gap-1.5 rounded-lg px-2 font-semibold',
          isTop ? 'bg-accent-soft text-accent-soft-foreground' : 'hover:bg-mist-100 dark:hover:bg-neutral-900',
        )}
      >
        <BookOpenIcon width={16} className='shrink-0' />
        <span className='truncate' title={space.name}>
          {space.name}
        </span>
        <ChevronDownIcon width={12} className='ml-auto shrink-0' />
      </Button>
      <Dropdown.Popover placement='bottom start'>
        <Dropdown.Menu
          aria-label={t('wiki_switch_space')}
          onAction={(key) => {
            router.push(key === ALL_SPACES_KEY ? '/wiki' : `/wiki/${key}`)
            closeMenu()
          }}
        >
          <Dropdown.Section
            aria-label={t('wiki_switch_space')}
            selectionMode='single'
            disallowEmptySelection
            selectedKeys={new Set([space.key])}
          >
            {spaces.map((s) => (
              <Dropdown.Item key={s.key} id={s.key} textValue={s.name}>
                <Dropdown.ItemIndicator />
                <Label className='truncate'>{s.name}</Label>
              </Dropdown.Item>
            ))}
          </Dropdown.Section>
          <Separator />
          <Dropdown.Section aria-label={t('wiki_all_spaces')}>
            <Dropdown.Item id={ALL_SPACES_KEY} textValue={t('wiki_all_spaces')}>
              <Dropdown.ItemIndicator // 選択はしないが、上のスペース名と頭をそろえる
              />
              <Label>{t('wiki_all_spaces')}</Label>
            </Dropdown.Item>
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
