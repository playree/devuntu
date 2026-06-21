'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, PencilSquareIcon, PlusIcon, PuzzlePieceIcon, Squares2X2Icon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { Accordion, ButtonGroup, Table } from '@heroui/react'
import { FC } from 'react'
import { deleteLinkWidget, getLinkWidgets } from './server'

export const LinkWidgetsManage: FC = () => {
  const { t } = useLocale()
  // const addModalState = useModalState()
  // const updateModalState = useModalState<UpdateUser>()

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getLinkWidgets())
      return res ?? []
    },
    sort: {
      init: { column: 'updatedAt', direction: 'descending' },
    },
  })

  return (
    <FlexCol>
      <ContentHeader>
        <MultiButton isIconOnly tooltip={t('add_user')}>
          <PlusIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => list.reload()}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        ariaLabel='user list'
        pagingList={list}
        columns={[
          { id: 'name', name: t('username'), isRowHeader: true, allowsSorting: true, minWidth: 80 },

          { id: 'updatedAt', name: t('updated_at'), allowsSorting: true, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>

            <Table.Cell className='font-mono text-xs'>{dayformat(item.updatedAt, 'jp-simple')}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'edit',
                  icon: <PencilSquareIcon />,
                  tooltip: t('update'),
                  onPress: () => {
                    // updateModalState.open(item)
                  },
                },
                {
                  template: 'delete',
                  target: item.name,
                  action: async () => {
                    await parseAction(deleteLinkWidget({ id: item.id }))
                    notify.success(t('msg_deleted_target', { target: item.name }))
                    list.reload()
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      {/* <AddModal state={addModalState} reload={list.reload} key={addModalState.key} enabledPassword={enabledPassword} />
      {updateModalState.target && (
        <UpdateModal
          state={updateModalState}
          reload={list.reload}
          key={updateModalState.key}
          target={updateModalState.target}
        />
      )} */}
    </FlexCol>
  )
}

const defaultExpandedKeys = new Set(['link_widget_manage'])
export const AdminDashboardClient: FC = () => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <ContentHeader icon={<Squares2X2Icon />} title={t('dashboard_manage')} />
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <Accordion.Item id='link_widget_manage'>
          <Accordion.Heading>
            <Accordion.Trigger className='gap-1'>
              <PuzzlePieceIcon />
              {t('link_widget_manage')}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className='px-4'>
              <LinkWidgetsManage />
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </FlexCol>
  )
}
