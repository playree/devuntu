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
import { AssigneeOption } from '@/components/ticket/assignee-select'
import { useBoardName } from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action/action-client'
import {
  applyLaneMove,
  countLaneMap,
  dedupeTagOptionsByName,
  DropTarget,
  emptyLaneMap,
  filterLaneMap,
  isKanbanFilterActive,
  LaneMap,
  MAX_KANBAN_CARDS,
  parseDropTarget,
} from '@/lib/board/task'
import { nowDate } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { DragDropProvider } from '@dnd-kit/react'
import { Accordion, ButtonGroup, Chip, cn } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useMemo, useState } from 'react'
// チケット詳細・作成フォームは /tickets と共通のものを使う(重複定義を避ける)
import { TicketDetailClient } from '../../tickets/[id]/client'
import { AddModal } from '../../tickets/modals'
import { getAssigneeOptions, getTicketFormOptions, GetTicketFormOptionsReturnType } from '../../tickets/server'
import { KanbanFilterPanel } from './filter-panel'
import { useKanbanFilter } from './filter-state'
import { KanbanCard, KanbanLane, LANE_ORDER } from './kanban'
import { getBoardKanban, moveTicket } from './server'

export const BoardKanbanClient: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const router = useRouter()
  const boardName = useBoardName()
  const tz = useUserTimezone()
  const addModalState = useModalState<TicketStatus>()

  const { data, reload, refresh, isLoading } = useActionData(() => getBoardKanban({ id: boardId }))
  const [options, setOptions] = useState<GetTicketFormOptionsReturnType>()
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([])
  const [filter, setFilter] = useKanbanFilter()
  // 詳細パネルに表示中のチケット。未選択なら undefined
  const [selectedId, setSelectedId] = useState<string>()
  // 楽観更新の結果。取得元(base)を持たせておくことで reload 後は自動的に破棄される
  const [optimistic, setOptimistic] = useState<{ base: unknown; lanes: LaneMap<KanbanCard> }>()

  const lanes = optimistic && optimistic.base === data ? optimistic.lanes : (data?.lanes ?? emptyLaneMap<KanbanCard>())

  // 絞り込みは描画にだけ効かせる。move() / applyLaneMove は絞り込み前の lanes を使い続けること
  // (index はレーンの実際の位置で送る必要があるため、絞り込み後の配列を渡すと並び順が壊れる)
  // 完了の表示期間の基準時刻は、盤面の取得か絞り込みの変更でこれが再評価されるたびに取り直す
  const visibleLanes = useMemo(() => filterLaneMap(lanes, filter, nowDate()), [lanes, filter])

  useEffect(() => {
    parseAction(getTicketFormOptions())
      .then(setOptions)
      .catch(() => setOptions(undefined))
  }, [])

  useEffect(() => {
    // ボードを続けて切り替えると古い要求が後着しうるので、対象が変わった結果は捨てる
    let isCurrent = true
    parseAction(getAssigneeOptions({ id: boardId }))
      .then((res) => isCurrent && setAssigneeOptions(res ?? []))
      .catch(() => isCurrent && setAssigneeOptions([]))
    return () => {
      isCurrent = false
    }
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

  /** DnD でのレーン移動 / 並べ替え。楽観更新し、失敗したらサーバー値を取り直す */
  const move = async (ticketId: string, target: DropTarget) => {
    const moved = applyLaneMove(lanes, { ticketId, target })
    if (!moved) {
      // 自分自身へのドロップ / 位置が変わらない移動は通信しない
      return
    }
    setOptimistic({ base: data, lanes: moved.lanes })

    try {
      await parseAction(moveTicket({ id: ticketId, status: moved.status, index: moved.index }))
      // 完了日時はサーバーが付け外しするので、done を出入りしたカードだけ取り直して表示を合わせる
      if (moved.from !== moved.status && (moved.status === 'done' || moved.from === 'done')) {
        refresh()
      }
    } catch {
      // 手元のスナップショットへ戻すと、その間に他ユーザーが成功させた移動まで巻き戻してしまう。
      // 再取得すれば optimistic.base !== data になり楽観値も自動で破棄される
      // (巻き戻しのために盤面をスケルトンへ差し替える必要はないので silent な refresh を使う)
      refresh()
      // parseAction は ClientError を notify せず throw するため、ここで明示的に表示する
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
    <FlexCol
      /**
       * 詳細パネルを開いている間は data-nav-hidden でサイドメニューを隠し、盤面の横幅を稼ぐ。
       * あわせて中央寄せ(mx-auto)をやめて左に寄せ、右のパネルと重なりにくくする。
       *
       * md 以上では盤面を 1 画面に収めてレーン内スクロールにする。高さの基準(画面高と padding)は
       * data-fit-screen を見た SideNavbar の #side-main 側が持つので、ここは親に追従させるだけにする。
       * 固定高(h-)ではなく max-h- なのは、カードが少ないときにレーンを画面下端まで伸ばさず内容ぶんの高さで収めるため。
       * md 未満はレーンが縦積みになり 1 画面に 4 レーンは詰め込めないので、従来どおりページ全体のスクロールにする。
       */
      data-wide
      data-fit-screen
      data-nav-hidden={selectedId ? '' : undefined}
      className={cn('max-w-7xl md:max-h-full', !selectedId && 'mx-auto')}
    >
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
            void move(sourceId, target)
          }
        }}
      >
        <Grid
          /**
           * 盤面の高さ。1行目が todo/doing/done、2行目が backlog(カード領域の max-h で頭打ち)。
           *
           * flex-1 で残りを総取りせず、minmax(0,1fr) の二役に任せる。
           * - 盤面が画面に収まるとき: grid の高さが不定なので 1行目は max-content(= 一番カードが多いレーン)になり、
           *   レーンは内容ぶんの高さで済む。1fr ではなく minmax(0,...) にするのは、行の下限が min-content に
           *   張り付くと下のケースで縮めず(レーン内スクロールが効かず)溢れるため。
           * - 収まらないとき: ルートの max-h で主軸長が確定して flex shrink が走り、この Grid が縮む。
           *   grid の高さが確定するので 1行目は「2行目を除いた残り」になり、従来どおりレーン内スクロールになる。
           * min-h-0 は、その shrink の受け皿をこの Grid に限定するため
           * (ヘッダーや Accordion は block 方向の automatic minimum size = 内容高なので縮まない)。
           */
          className='md:min-h-0 md:grid-rows-[minmax(0,1fr)_auto]'
        >
          {LANE_ORDER.map((status) => (
            <KanbanLane
              key={status}
              status={status}
              cards={visibleLanes[status]}
              tz={tz}
              selectedId={selectedId}
              onAdd={() => addModalState.open(status)}
              onSelect={(ticketId, selected) => setSelectedId(selected ? ticketId : undefined)}
            />
          ))}
        </Grid>
      </DragDropProvider>

      <SideDrawer isOpen={!!selectedId} ariaLabel={t('ticket')} className='bg-background border-l p-4 shadow-2xl'>
        {selectedId && (
          <TicketDetailClient
            // id が変わっても useActionData は再取得しないため、選択のたびに作り直す
            key={selectedId}
            id={selectedId}
            onClose={() => setSelectedId(undefined)}
            /**
             * 詳細側の変更(ステータス変更によるレーン移動を含む)を盤面へ反映する。
             * reload だと isLoading で盤面ごとスケルトンに差し替わり、この詳細パネル自身が
             * アンマウントされてしまうため silent な refresh を使う
             */
            onChanged={refresh}
          />
        )}
      </SideDrawer>

      {options && (
        <AddModal
          key={addModalState.key}
          state={addModalState}
          /** 追加直後に盤面をスケルトンへ差し替えたくないので silent な refresh を渡す */
          reload={refresh}
          options={options}
          defaultBoardId={board.id}
          defaultStatus={addModalState.target ?? 'todo'}
          isBoardLocked
        />
      )}
    </FlexCol>
  )
}
