'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { SideDrawer } from '@/components/general/drawer'
import { FlexCol } from '@/components/general/flex'
import { Grid } from '@/components/general/grid'
import { useModalState } from '@/components/general/modal'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import {
  ArrowLeftCircleIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  Cog6ToothIcon,
  FunnelIcon,
  ViewColumnsIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { useBoardName } from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action-client'
import {
  applyLaneMove,
  countLaneMap,
  dedupeTagOptionsByName,
  defaultKanbanFilter,
  DropTarget,
  emptyLaneMap,
  filterLaneMap,
  isKanbanFilterActive,
  KanbanFilter,
  LaneMap,
  MAX_KANBAN_CARDS,
  parseDropTarget,
} from '@/lib/task'
import { useLocale } from '@/locale/client'
import { DragDropProvider } from '@dnd-kit/react'
import { Accordion, ButtonGroup, Chip } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useMemo, useState } from 'react'
// チケット詳細・作成フォームは /tickets と共通のものを使う(重複定義を避ける)
import { TicketDetailClient } from '../../tickets/[id]/client'
import { AddModal } from '../../tickets/modals'
import { getAssigneeOptions, getTicketFormOptions, GetTicketFormOptionsReturnType } from '../../tickets/server'
import { KanbanFilterPanel } from './filter-panel'
import { KanbanCard, KanbanLane, LANE_ORDER } from './kanban'
import { getBoardKanban, moveTicket } from './server'

export const BoardKanbanClient: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const router = useRouter()
  const boardName = useBoardName()
  const addModalState = useModalState<TicketStatus>()

  const { data, reload, isLoading } = useActionData(() => getBoardKanban({ id: boardId }))
  const [options, setOptions] = useState<GetTicketFormOptionsReturnType>()
  const [assigneeOptions, setAssigneeOptions] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<KanbanFilter>(defaultKanbanFilter)
  // 詳細パネルに表示中のチケット。未選択なら undefined
  const [selectedId, setSelectedId] = useState<string>()
  // 楽観更新の結果。取得元(base)を持たせておくことで reload 後は自動的に破棄される
  const [optimistic, setOptimistic] = useState<{ base: unknown; lanes: LaneMap<KanbanCard> }>()

  const lanes = optimistic && optimistic.base === data ? optimistic.lanes : (data?.lanes ?? emptyLaneMap<KanbanCard>())

  // 絞り込みは描画にだけ効かせる。move() / applyLaneMove は絞り込み前の lanes を使い続けること
  // (index はレーンの実際の位置で送る必要があるため、絞り込み後の配列を渡すと並び順が壊れる)
  const visibleLanes = useMemo(() => filterLaneMap(lanes, filter), [lanes, filter])

  useEffect(() => {
    parseAction(getTicketFormOptions())
      .then(setOptions)
      .catch(() => setOptions(undefined))
  }, [])

  useEffect(() => {
    parseAction(getAssigneeOptions({ id: boardId }))
      .then((res) => setAssigneeOptions(res ?? {}))
      .catch(() => setAssigneeOptions({}))
  }, [boardId])

  // Escape で詳細パネルを閉じる。
  // モーダルやポップオーバーが処理済みの Escape(defaultPrevented)と、
  // 入力中の Escape は入力内容を失わせないため無視する。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) {
        return
      }
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, [contenteditable="true"]')) {
        return
      }
      setSelectedId(undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /** DnD でのレーン移動 / 並べ替え。楽観更新し、失敗したら元に戻す */
  const move = async (ticketId: string, target: DropTarget) => {
    const prev = lanes
    const moved = applyLaneMove(prev, { ticketId, target })
    if (!moved) {
      // 自分自身へのドロップ / 位置が変わらない移動は通信しない
      return
    }
    setOptimistic({ base: data, lanes: moved.lanes })

    try {
      await parseAction(moveTicket({ id: ticketId, status: moved.status, index: moved.index }))
    } catch {
      // parseAction は ClientError を notify せず throw するため、ここで明示的に表示する
      setOptimistic({ base: data, lanes: prev })
      notify.error(t('error'))
    }
  }

  if (isLoading) {
    return <PanelSkeleton />
  }

  if (!data) {
    return (
      <FlexCol>
        <ContentHeader icon={<ViewColumnsIcon />} title={t('board')}>
          <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/boards')}>
            <ArrowLeftCircleIcon />
          </MultiButton>
        </ContentHeader>
        <NoticePanel>{t('msg_no_access')}</NoticePanel>
      </FlexCol>
    )
  }

  const { board } = data
  // タグの選択肢は取得済みの options から作る(かんばんは単一ボードなのでそのボードの分だけ)
  const tagChoices = dedupeTagOptionsByName((options?.tags ?? []).filter((tag) => tag.boardId === board.id))
  const isFiltered = isKanbanFilterActive(filter)

  return (
    // 詳細パネルを開いている間は data-nav-hidden でサイドメニューを隠し、盤面の横幅を稼ぐ
    <FlexCol data-wide data-nav-hidden={selectedId ? '' : undefined}>
      <ContentHeader icon={<ViewColumnsIcon />} title={boardName(board)}>
        <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/boards')}>
          <ArrowLeftCircleIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('ticket')} onPress={() => router.push(`/tickets?boardId=${board.id}`)}>
          <ButtonGroup.Separator />
          <ArrowTopRightOnSquareIcon />
        </MultiButton>
        <MultiButton
          isIconOnly
          tooltip={t('board_settings')}
          onPress={() => router.push(`/boards/${board.id}/settings`)}
        >
          <ButtonGroup.Separator />
          <Cog6ToothIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={reload}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      {board.archived && (
        <div>
          <Chip variant='soft' color='warning' size='sm'>
            <Chip.Label>{t('archived')}</Chip.Label>
          </Chip>
        </div>
      )}

      <Accordion // かんばんは縦の表示領域が貴重なので既定は折りたたみ。絞り込み中は見出しに件数を出して気づけるようにする
        allowsMultipleExpanded
        hideSeparator
      >
        <AccordionSection
          id='filter'
          icon={<FunnelIcon />}
          title={
            <span className='flex items-center gap-2'>
              {t('filter')}
              {isFiltered && (
                <Chip variant='soft' color='accent' size='sm'>
                  <Chip.Label>{`${countLaneMap(visibleLanes)} / ${data.total}`}</Chip.Label>
                </Chip>
              )}
            </span>
          }
        >
          <KanbanFilterPanel filter={filter} onChange={setFilter} assigneeOptions={assigneeOptions} tags={tagChoices} />
        </AccordionSection>
      </Accordion>

      {data.total >= MAX_KANBAN_CARDS && (
        <div className='px-1 text-xs text-gray-500'>{t('msg_ticket_list_limit', { max: `${MAX_KANBAN_CARDS}` })}</div>
      )}

      <DragDropProvider
        onDragEnd={({ operation, canceled }) => {
          if (canceled) {
            return
          }
          const sourceId = operation.source?.id.toString()
          const target = operation.target ? parseDropTarget(operation.target.id.toString()) : null
          if (sourceId && target) {
            move(sourceId, target)
          }
        }}
      >
        <Grid>
          {LANE_ORDER.map((status) => (
            <KanbanLane
              key={status}
              status={status}
              cards={visibleLanes[status]}
              selectedId={selectedId}
              onAdd={() => addModalState.open(status)}
              onSelect={(ticketId, selected) => setSelectedId(selected ? ticketId : undefined)}
            />
          ))}
        </Grid>
      </DragDropProvider>

      <SideDrawer isOpen={!!selectedId} className='bg-background border-l p-4 shadow-2xl'>
        {selectedId && (
          <TicketDetailClient
            // id が変わっても useActionData は再取得しないため、選択のたびに作り直す
            key={selectedId}
            id={selectedId}
            onClose={() => setSelectedId(undefined)}
            /** 詳細側の変更(ステータス変更によるレーン移動を含む)を盤面へ反映する */
            onChanged={reload}
          />
        )}
      </SideDrawer>

      {options && (
        <AddModal
          key={addModalState.key}
          state={addModalState}
          reload={reload}
          options={options}
          defaultBoardId={board.id}
          defaultStatus={addModalState.target ?? 'todo'}
          isBoardLocked
        />
      )}
    </FlexCol>
  )
}
