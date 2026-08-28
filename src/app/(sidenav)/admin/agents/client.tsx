'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, Cog6ToothIcon, CpuChipIcon, PlusIcon } from '@/components/icon'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { type AgentRunnerStatus } from '@/lib/agent/agent'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Chip, Table } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { AddModal } from './modals'
import { type AgentTokenStatus, getAgents, getGroupOptions } from './server'

/** エージェントは1本しかトークンを持たないので、件数ではなく状態を出す */
const TokenStatusChip: FC<{ status: AgentTokenStatus }> = ({ status }) => {
  const { t } = useLocale()
  const { color, label } = {
    none: { color: 'default', label: t('not_issued') },
    active: { color: 'success', label: t('token_active') },
    expired: { color: 'warning', label: t('token_expired') },
  }[status] as { color: 'default' | 'success' | 'warning'; label: string }

  return (
    <Chip color={color} variant='soft'>
      {label}
    </Chip>
  )
}

/** ランナーの稼働状況。未設定 / 停止中 は設定の問題、オフラインはランナー側の問題を表す */
const RunnerStatusChip: FC<{ status: AgentRunnerStatus }> = ({ status }) => {
  const { t } = useLocale()
  const { color, label } = {
    none: { color: 'default', label: t('agent_runner_none') },
    disabled: { color: 'default', label: t('agent_runner_disabled') },
    online: { color: 'success', label: t('agent_runner_online') },
    offline: { color: 'warning', label: t('agent_runner_offline') },
  }[status] as { color: 'default' | 'success' | 'warning'; label: string }

  return (
    <Chip // 「オフライン」が列幅で折り返さないようにする
      color={color}
      variant='soft'
      className='whitespace-nowrap'
    >
      {label}
    </Chip>
  )
}

export const AdminAgentsClient: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const router = useRouter()
  const addModalState = useModalState()
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
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 100 },
          { id: 'email', name: t('email'), allowsSorting: true, minWidth: 120, defaultWidth: '2fr' },
          { id: 'groups', name: t('group'), minWidth: 88, defaultWidth: '1fr' },
          { id: 'tokenStatus', name: t('agent_token'), allowsSorting: true, minWidth: 80, defaultWidth: 90 },
          { id: 'runnerStatus', name: t('agent_runner'), allowsSorting: true, minWidth: 90, defaultWidth: 100 },
          { id: 'lastUsedAt', name: t('last_used'), allowsSorting: true, minWidth: 115 },
          { id: 'createdAt', name: t('created_at'), allowsSorting: true, minWidth: 115 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 90 },
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
            <Table.Cell>
              <TokenStatusChip status={item.tokenStatus} />
            </Table.Cell>
            <Table.Cell>
              <RunnerStatusChip status={item.runnerStatus} />
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>
              {item.lastUsedAt ? dayformat(item.lastUsedAt, 'tz-minute', tz) : ''}
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'tz-minute', tz)}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'settings',
                  icon: <Cog6ToothIcon />,
                  tooltip: t('agent_settings'),
                  onPress: () => {
                    router.push(`/admin/agents/${item.id}`)
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <AddModal state={addModalState} reload={list.reload} key={addModalState.key} groupOptions={groupOptions ?? {}} />
    </FlexCol>
  )
}
