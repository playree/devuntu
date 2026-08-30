'use client'

import { MultiButton } from '@/components/general/button'
import { SideDrawer } from '@/components/general/drawer'
import { FlexCol } from '@/components/general/flex'
import { GridBox } from '@/components/general/grid'
import { useServerPagingList } from '@/components/general/paging'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectField } from '@/components/general/select'
import { MultiTable, SelectionCell } from '@/components/general/table'
import { MultiTagField } from '@/components/general/tag-group'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CpuChipIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import {
  AGENT_MODE_NONE,
  AgentStateChip,
  PriorityChip,
  StatusChip,
  TicketIdText,
  useAgentModeOptions,
  useAgentStateOptions,
  useBoardName,
} from '@/components/ticket/ticket-chip'
import type { AgentTaskMode, AgentTaskState } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { AGENT_TASK_STATES, OPEN_AGENT_TASK_STATES } from '@/lib/agent/agent'
import { preventParentSelection } from '@/lib/client-utils'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { cn, Table } from '@heroui/react'
import Link from 'next/link'
import { FC, useEffect, useRef, useState } from 'react'
import { TicketDetailClient } from '../tickets/[id]/client'
import { updateTicketAgentMode } from '../tickets/[id]/server'
import { getAgentTickets, getApprovableAgents } from './server'

/**
 * エージェントの承認画面。
 *
 * ログインユーザーが承認者になっているエージェントを選び、その担当チケットの内容を確認して
 * エージェントモード(= 自動実行の許可)を切り替える。
 */
export const AgentsClient: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const boardName = useBoardName()
  const agentModeOptions = useAgentModeOptions()
  const agentStateOptions = useAgentStateOptions()

  const { data: agents, isLoading: isAgentsLoading, reload: reloadAgents } = useActionData(getApprovableAgents)
  // 未選択(null)のうちは先頭のエージェントを見る。選択済みならその値を優先する
  const [pickedAgentId, setPickedAgentId] = useState<string | null>(null)
  // 詳細パネルに表示中のチケット。未選択なら undefined
  const [selectedId, setSelectedId] = useState<string>()
  // 保存中のチケット。二重操作を防ぐために行単位で持つ
  const [savingId, setSavingId] = useState<string>()

  // 処理状態の絞り込み。完了済みは承認する余地が無いので初期表示から外す
  const [agentStates, setAgentStates] = useState<AgentTaskState[]>([...OPEN_AGENT_TASK_STATES])

  const agentId = pickedAgentId ?? agents?.[0]?.id ?? null
  // loadPage は毎レンダリング作り直されるため、対象のエージェントと絞り込み条件は ref から読む
  const agentIdRef = useRef<string | null>(null)
  const agentStatesRef = useRef(agentStates)

  const list = useServerPagingList({
    loadPage: async (query) => {
      const id = agentIdRef.current
      if (!id) {
        return { items: [], total: 0 }
      }
      const res = await parseAction(getAgentTickets({ agentId: id, agentState: agentStatesRef.current, ...query }))
      return res ?? { items: [], total: 0 }
    },
    sort: { init: { column: 'updatedAt', direction: 'descending' } },
  })

  // エージェントが決まった / 切り替わったときだけ取得し直す(初回マウント時の二重取得を避ける)
  useEffect(() => {
    if (agentIdRef.current === agentId) {
      return
    }
    agentIdRef.current = agentId
    list.resetPage()
    list.reload()
    // list は毎レンダリング作り直されるため、エージェントの切り替えだけを契機にする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  const applyAgentStates = (next: AgentTaskState[]) => {
    agentStatesRef.current = next
    setAgentStates(next)
    // 条件が変われば件数も変わるため、前の条件でのページ位置は引き継がない
    list.resetPage()
    list.reload()
  }

  const reloadAll = () => {
    reloadAgents()
    list.reload()
  }

  const changeAgentMode = async (ticketId: string, agentMode: AgentTaskMode | null) => {
    setSavingId(ticketId)
    try {
      await parseAction(updateTicketAgentMode({ id: ticketId, agentMode }))
      notify.success(t('msg_saved'))
      list.reload()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setSavingId(undefined)
    }
  }

  if (isAgentsLoading) {
    return <PanelSkeleton />
  }

  const agentOptions = Object.fromEntries((agents ?? []).map((agent) => [agent.id, agent.name]))

  return (
    // 詳細パネルを開いている間は data-nav-hidden でサイドメニューを隠し、横幅を稼ぐ
    <FlexCol
      data-wide
      data-nav-hidden={selectedId ? '' : undefined}
      className={cn('max-w-6xl', !selectedId && 'mx-auto')}
    >
      <ContentHeader icon={<CpuChipIcon />} title={t('agent')}>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={reloadAll}>
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      {(agents ?? []).length === 0 ? (
        <NoticePanel>{t('msg_no_approvable_agent')}</NoticePanel>
      ) : (
        <>
          <GridBox isSmart>
            <div className='col-span-12 md:col-span-4'>
              <SingleSelectField
                isSmart
                label={t('agent')}
                groupOptions={agentOptions}
                value={agentId}
                onChange={(next) => {
                  setSelectedId(undefined)
                  setPickedAgentId(next)
                }}
              />
            </div>

            <div className='col-span-12 md:col-span-5'>
              <MultiTagField // 全解除は「絞り込みなし」(すべての処理状態)として扱う
                label={t('agent_state')}
                items={AGENT_TASK_STATES.map((state) => ({ id: state, label: agentStateOptions[state] }))}
                value={agentStates}
                onChange={applyAgentStates}
              />
            </div>
          </GridBox>

          <MultiTable
            ariaLabel='agent ticket list'
            isSmart
            pagingList={list}
            selectionMode='single'
            selectionBehavior='toggle'
            selectedKeys={selectedId ? [selectedId] : []}
            onSelectionChange={(keys) => {
              // 'all' は単一選択では発生しないが、型の都合で除外する
              const next = keys === 'all' ? undefined : [...keys][0]
              setSelectedId(next === undefined ? undefined : String(next))
            }}
            columns={[
              { id: 'displayId', name: t('id'), allowsSorting: false, minWidth: 80, defaultWidth: 90 },
              {
                id: 'title',
                name: t('title'),
                isRowHeader: true,
                allowsSorting: true,
                minWidth: 140,
                defaultWidth: '2fr',
              },
              { id: 'status', name: t('status'), allowsSorting: true, minWidth: 120, defaultWidth: 120 },
              { id: 'priority', name: t('priority'), allowsSorting: true, minWidth: 70, defaultWidth: 70 },
              { id: 'agentState', name: t('agent_state'), allowsSorting: false, minWidth: 100, defaultWidth: 110 },
              { id: 'agentMode', name: t('agent_mode'), allowsSorting: false, minWidth: 150, defaultWidth: 170 },
              { id: 'updatedAt', name: t('updated_at'), allowsSorting: true, minWidth: 110, defaultWidth: 110 },
            ]}
          >
            {(item) => (
              <Table.Row key={item.id} id={item.id}>
                <SelectionCell />
                <Table.Cell>
                  <TicketIdText displayId={item.displayId} />
                </Table.Cell>
                <Table.Cell>
                  <div className='flex flex-col gap-0.5'>
                    <Link // 件名は詳細ページへのリンク。行選択と同時に走ると遷移直前に詳細パネルが見えるので抑止する
                      href={`/tickets/${item.id}`}
                      className='truncate hover:underline'
                      {...preventParentSelection}
                    >
                      {item.title}
                    </Link>
                    <span className='text-xs text-gray-500'>
                      {boardName({ name: item.boardName, kind: item.boardKind })}
                    </span>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <StatusChip status={item.status} />
                </Table.Cell>
                <Table.Cell>
                  <PriorityChip priority={item.priority} />
                </Table.Cell>
                <Table.Cell>
                  <AgentStateChip state={item.agentState} />
                </Table.Cell>
                <Table.Cell {...preventParentSelection}>
                  <SingleSelectField
                    isSmart
                    isLabelHidden
                    label={t('agent_mode')}
                    groupOptions={agentModeOptions}
                    value={item.agentMode ?? AGENT_MODE_NONE}
                    isDisabled={savingId === item.id || !item.canEditAgentMode}
                    onChange={(next) => {
                      const value = next === AGENT_MODE_NONE ? null : (next as AgentTaskMode)
                      if (next !== null && value !== (item.agentMode ?? null)) {
                        void changeAgentMode(item.id, value)
                      }
                    }}
                  />
                </Table.Cell>
                <Table.Cell className='font-mono text-xs'>{dayformat(item.updatedAt, 'tz-simple', tz)}</Table.Cell>
              </Table.Row>
            )}
          </MultiTable>
        </>
      )}

      <SideDrawer
        isOpen={!!selectedId}
        ariaLabel={t('ticket')}
        onClose={() => setSelectedId(undefined)}
        className='bg-background border-l p-4 shadow-2xl'
      >
        {selectedId && (
          <TicketDetailClient
            // id が変わっても useActionData は再取得しないため、選択のたびに作り直す
            key={selectedId}
            id={selectedId}
            onClose={() => setSelectedId(undefined)}
            onChanged={() => list.reload()}
          />
        )}
      </SideDrawer>
    </FlexCol>
  )
}
