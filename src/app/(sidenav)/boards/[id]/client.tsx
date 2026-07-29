'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { Grid } from '@/components/general/grid'
import { useModalState } from '@/components/general/modal'
import { ContentHeader } from '@/components/header'
import {
  ArrowLeftCircleIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  Cog6ToothIcon,
  ViewColumnsIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { useBoardName } from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action-client'
import { applyLaneMove, DropTarget, emptyLaneMap, LaneMap, MAX_KANBAN_CARDS, parseDropTarget } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { DragDropProvider } from '@dnd-kit/react'
import { ButtonGroup, Chip, Skeleton } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'
// チケット作成フォームは /tickets と共通のものを使う(重複定義を避ける)
import { AddModal } from '../../tickets/modals'
import { getTicketFormOptions, GetTicketFormOptionsReturnType } from '../../tickets/server'
import { KanbanCard, KanbanLane, LANE_ORDER } from './kanban'
import { getBoardKanban, moveTicket } from './server'

export const BoardKanbanClient: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const router = useRouter()
  const boardName = useBoardName()
  const addModalState = useModalState<TicketStatus>()

  const { data, reload, isLoading } = useActionData(() => getBoardKanban({ id: boardId }))
  const [options, setOptions] = useState<GetTicketFormOptionsReturnType>()
  // 楽観更新の結果。取得元(base)を持たせておくことで reload 後は自動的に破棄される
  const [optimistic, setOptimistic] = useState<{ base: unknown; lanes: LaneMap<KanbanCard> }>()

  const lanes = optimistic && optimistic.base === data ? optimistic.lanes : (data?.lanes ?? emptyLaneMap<KanbanCard>())

  useEffect(() => {
    parseAction(getTicketFormOptions())
      .then(setOptions)
      .catch(() => setOptions(undefined))
  }, [])

  /** DnD とカード内 Select の共通経路。楽観更新し、失敗したら元に戻す */
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
    return <Skeleton className='min-h-48 w-full rounded-xl' />
  }

  if (!data) {
    return (
      <FlexCol>
        <ContentHeader icon={<ViewColumnsIcon />} title={t('board')}>
          <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/boards')}>
            <ArrowLeftCircleIcon />
          </MultiButton>
        </ContentHeader>
        <div className='rounded-xl border-2 p-4 text-sm'>{t('msg_no_access')}</div>
      </FlexCol>
    )
  }

  const { board } = data

  return (
    <FlexCol data-wide>
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
              cards={lanes[status]}
              onAdd={() => addModalState.open(status)}
              onChangeStatus={(card, next) => move(card.id, { kind: 'lane', status: next })}
            />
          ))}
        </Grid>
      </DragDropProvider>

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
