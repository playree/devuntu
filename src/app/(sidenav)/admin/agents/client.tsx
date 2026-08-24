'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CpuChipIcon, KeyIcon, PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Chip, Table } from '@heroui/react'
import { FC } from 'react'
import { AddModal, UpdateModal } from './modals'
import { deleteAgent, getAgents, getGroupOptions } from './server'
import { TokenModal } from './token-modal'

/** 一覧の 1 行。モーダルへそのまま渡すのでここで型を作る */
export type AgentRow = {
  id: string
  name: string
  email: string
  groups: { id: string; name: string }[]
}

export const AdminAgentsClient: FC<{ baseUrl: string }> = ({ baseUrl }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const addModalState = useModalState()
  const updateModalState = useModalState<AgentRow>()
  const tokenModalState = useModalState<AgentRow>()
  const { data: groupOptions } = useActionData(getGroupOptions)

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getAgents())
      return res ?? []
    },
    sort: {
      init: { column: 'createdAt', direction: 'descending' },
    },
  })

  return (
    <FlexCol>
      <ContentHeader icon={<CpuChipIcon />} title={t('agent_manage')}>
        <MultiButton isIconOnly tooltip={t('add_agent')} onPress={() => addModalState.open()}>
          <PlusIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => list.reload()}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        isSmart
        ariaLabel='agent list'
        pagingList={list}
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 110 },
          { id: 'email', name: t('email'), allowsSorting: true, minWidth: 140, defaultWidth: '2fr' },
          { id: 'groups', name: t('group'), minWidth: 80, defaultWidth: '1fr' },
          { id: 'tokenCount', name: t('token_count'), allowsSorting: true, minWidth: 90, defaultWidth: 90 },
          { id: 'lastUsedAt', name: t('last_used'), allowsSorting: true, minWidth: 110 },
          { id: 'createdAt', name: t('created_at'), allowsSorting: true, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 130 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell className='truncate'>{item.name}</Table.Cell>
            <Table.Cell className='truncate font-mono text-xs'>{item.email}</Table.Cell>
            <Table.Cell>
              <span className='flex flex-wrap gap-1'>
                {item.groups.map((group) => (
                  <Chip key={group.id} variant='soft'>
                    {group.name}
                  </Chip>
                ))}
              </span>
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>{item.tokenCount}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>
              {item.lastUsedAt ? dayformat(item.lastUsedAt, 'tz-simple', tz) : ''}
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'tz-simple', tz)}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'token',
                  icon: <KeyIcon />,
                  tooltip: t('agent_token'),
                  onPress: () => {
                    tokenModalState.open(item)
                  },
                },
                {
                  template: 'none',
                  key: 'edit',
                  icon: <PencilSquareIcon />,
                  tooltip: t('update'),
                  onPress: () => {
                    updateModalState.open(item)
                  },
                },
                {
                  template: 'delete',
                  target: item.name,
                  action: async () => {
                    await parseAction(deleteAgent({ id: item.id }))
                    notify.success(t('msg_deleted_target', { target: item.name }))
                    list.reload()
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <AddModal state={addModalState} reload={list.reload} key={addModalState.key} groupOptions={groupOptions ?? {}} />
      {updateModalState.target && (
        <UpdateModal
          state={updateModalState}
          reload={list.reload}
          key={updateModalState.key}
          target={updateModalState.target}
          groupOptions={groupOptions ?? {}}
        />
      )}
      {tokenModalState.target && (
        <TokenModal
          state={tokenModalState}
          reload={list.reload}
          key={tokenModalState.key}
          target={tokenModalState.target}
          baseUrl={baseUrl}
        />
      )}
    </FlexCol>
  )
}
