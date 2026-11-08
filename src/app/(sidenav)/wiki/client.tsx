'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { OnOffChip } from '@/components/general/chip'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { SwitchField } from '@/components/general/switch'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { BookOpenIcon, Cog6ToothIcon, PlusIcon } from '@/components/icon'
import { ReloadButton } from '@/components/reload-button'
import { WikiRoleChip, WikiVisibilityChip } from '@/components/wiki-chip'
import { parseAction } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Table } from '@heroui/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { AddSpaceModal } from './modals'
import { getWikiSpaces } from './server'

export const WikiSpacesClient: FC = () => {
  const { t } = useLocale()
  const router = useRouter()
  const addModalState = useModalState()

  const list = usePagingList({
    // 表示の出し入れはスイッチ(クライアントフィルタ)で行うため、アーカイブ済みも含めて取る
    load: async () => await parseAction(getWikiSpaces({ includeArchived: true })),
    filter: {
      // usePagingList のフィルタ値は文字列のみなので '1' / '' で ON/OFF を表す
      init: { showArchived: '' },
      proc: (item, { showArchived }) => showArchived === '1' || !item.archived,
    },
    sort: { init: { column: 'name', direction: 'ascending' } },
  })

  return (
    <FlexCol>
      <ContentHeader
        icon={<BookOpenIcon />}
        title={t('wiki')}
        extra={
          <SwitchField
            id='show-archived'
            label={t('show_archived')}
            isSmart
            onChange={(isSelected) => list.setFilter({ showArchived: isSelected ? '1' : '' })}
          />
        }
      >
        <MultiButton
          isIconOnly
          tooltip={t('wiki_add_space')}
          icon={<PlusIcon />}
          onPress={() => addModalState.open()}
        />
        <ReloadButton onReload={list.reload} />
      </ContentHeader>

      <MultiTable
        aria-label='wiki space list'
        pagingList={list}
        emptyContent={t('msg_no_wiki_spaces')}
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 140, defaultWidth: '2fr' },
          { id: 'description', name: t('description'), allowsSorting: false, minWidth: 120, defaultWidth: '2fr' },
          { id: 'visibility', name: t('wiki_visibility'), allowsSorting: true, minWidth: 90 },
          { id: 'role', name: t('role'), allowsSorting: true, minWidth: 80 },
          { id: 'archived', name: t('archived'), allowsSorting: true, minWidth: 80 },
          { id: 'settings', name: t('settings'), allowsSorting: false, defaultWidth: 90 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>
              <div className='flex flex-col gap-0.5'>
                <Link href={`/wiki/${item.key}`} className='truncate hover:underline'>
                  {item.name}
                </Link>
                <span className='text-muted font-mono text-xs'>{item.key}</span>
              </div>
            </Table.Cell>
            <Table.Cell className='truncate'>{item.description ?? '-'}</Table.Cell>
            <Table.Cell>
              <WikiVisibilityChip value={item.visibility} />
            </Table.Cell>
            <Table.Cell>{item.role ? <WikiRoleChip value={item.role} /> : '-'}</Table.Cell>
            <Table.Cell>
              <OnOffChip isState={item.archived} isIconOnly />
            </Table.Cell>
            <ActionCell
              items={
                item.canManage
                  ? [
                      {
                        template: 'none',
                        key: 'settings',
                        icon: <Cog6ToothIcon />,
                        tooltip: t('wiki_space_settings'),
                        onPress: () => router.push(`/wiki/${item.key}/settings`),
                      },
                    ]
                  : []
              }
            />
          </Table.Row>
        )}
      </MultiTable>

      <AddSpaceModal state={addModalState} reload={list.reload} key={addModalState.key} />
    </FlexCol>
  )
}
