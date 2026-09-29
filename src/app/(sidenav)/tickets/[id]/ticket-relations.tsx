'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { SingleSelectField } from '@/components/general/select'
import {
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LinkIcon,
  PlusIcon,
  XMarkIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { StatusChip, TicketIdText } from '@/components/ticket/ticket-chip'
import { TicketSelectField, useTicketCandidates } from '@/components/ticket/ticket-select'
import { parseAction } from '@/lib/action/action-client'
import {
  relatedTicketListPath,
  RELATION_ALREADY_EXISTS,
  RELATION_TARGET_INVALID,
  TICKET_CHILD_ADVANCE_LOCALE,
  TICKET_CHILD_ADVANCES,
  TICKET_RELATION_KIND_LOCALE,
  TICKET_RELATION_KINDS,
  type TicketRelationFilter,
  type TicketRelationKind,
} from '@/lib/board/ticket-relation-rule'
import { ClientError } from '@/lib/error'
import { zRelationTarget } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import Link from 'next/link'
import { FC, ReactNode, useCallback, useState } from 'react'
import { tv } from 'tailwind-variants'
import {
  addTicketRelation,
  GetTicketReturnType,
  moveTicketChild,
  patchTicket,
  removeTicketRelation,
  searchRelationCandidates,
} from './server'

type Ticket = NonNullable<GetTicketReturnType>
type Relations = Ticket['relations']
type RelatedTicket = Relations['related'][number]
type ChildTicket = Relations['children'][number]

type MoveOffset = -1 | 1

/**
 * 子を兄弟の中で前後に動かすボタン。移動中の状態は一覧側で持ち、
 * どれかの子が移動中の間は全ての子のボタンを止める(古い並びを前提にした移動を重ねない)
 */
const ChildMoveButtons: FC<{
  isFirst: boolean
  isLast: boolean
  /** この子が移動中なら、その向き */
  moving?: MoveOffset
  isLocked: boolean
  onMove: (offset: MoveOffset) => void
}> = ({ isFirst, isLast, moving, isLocked, onMove }) => {
  const { t } = useLocale()

  return (
    <div className='flex shrink-0'>
      <MultiButton
        isIconOnly
        size='sm'
        variant='ghost'
        tooltip={t('move_up')}
        icon={<ChevronUpIcon width={16} />}
        isPending={moving === -1}
        isDisabled={isFirst || isLocked}
        onPress={() => onMove(-1)}
      />
      <MultiButton
        isIconOnly
        size='sm'
        variant='ghost'
        tooltip={t('move_down')}
        icon={<ChevronDownIcon width={16} />}
        isPending={moving === 1}
        isDisabled={isLast || isLocked}
        onPress={() => onMove(1)}
      />
    </div>
  )
}

/** 関係の相手 1 件。子は先頭に順番、削除の前に並べ替えを置く */
const RelationItem: FC<{
  item: RelatedTicket
  canEdit: boolean
  refresh: () => Promise<void>
  /** 子の順番。同じ値の子は並行して進められるので、並び位置とは別に値を見せる */
  order?: number
  actions?: ReactNode
}> = ({ item, canEdit, refresh, order, actions }) => {
  const { t } = useLocale()
  const [isRemoving, setRemoving] = useState(false)

  const remove = async () => {
    setRemoving(true)
    try {
      await parseAction(removeTicketRelation({ id: item.relationId }))
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setRemoving(false)
    }
  }

  return (
    <li // マーカーを出すため li 自体は flex にしない
    >
      <div className='dark:bg-default/40 flex items-center gap-2 rounded-lg bg-white pr-1 pl-2'>
        <div className='flex min-w-0 grow flex-wrap items-center gap-x-2 gap-y-0.5'>
          {order !== undefined && (
            <span className='text-muted font-mono text-xs' title={t('child_order')}>
              #{order}
            </span>
          )}
          <Link href={`/tickets/${item.id}`} className='flex min-w-0 items-center gap-2 text-sm hover:underline'>
            <TicketIdText displayId={item.displayId} className='shrink-0' />
            <span className='min-w-0 truncate text-xs'>{item.title}</span>
          </Link>
          <StatusChip value={item.status} />
          {item.assigneeName && <span className='text-muted truncate text-xs'>{item.assigneeName}</span>}
        </div>
        {canEdit && actions}
        {canEdit && (
          <MultiButton
            isIconOnly
            size='sm'
            variant='ghost'
            className='shrink-0'
            tooltip={t('relation_remove')}
            icon={<XMarkIcon width={16} />}
            isPending={isRemoving}
            onPress={remove}
          />
        )}
      </div>
    </li>
  )
}

const relationList = tv({
  base: 'space-y-1',
  variants: {
    // 複数件並ぶ子と関連だけ行頭にマーカーを付ける
    isBullet: { true: 'marker:text-muted list-disc pl-6', false: 'pl-2' },
  },
})

/** 親 / 子 / 関連の見出し付きの一覧。空なら見出しごと出さない */
const RelationGroup: FC<{
  title: ReactNode
  /** チケット一覧で開くときの絞り込み。親は 1 件だけなので渡さない */
  listFilter?: { displayId: string; relation: TicketRelationFilter }
  isEmpty: boolean
  isBullet?: boolean
  children: ReactNode
}> = ({ title, listFilter, isEmpty, isBullet = false, children }) => {
  const { t } = useLocale()
  if (isEmpty) {
    return null
  }
  return (
    <div className='space-y-1'>
      <div className='flex items-center gap-2 text-sm'>
        <span className='text-foreground text-xs'>{title}</span>
        {listFilter && (
          <Link
            href={relatedTicketListPath(listFilter.displayId, listFilter.relation)}
            className='text-accent inline-flex items-center gap-0.5 text-xs underline-offset-2 hover:underline'
          >
            <ArrowTopRightOnSquareIcon width={14} />
            {t('show_in_ticket_list')}
          </Link>
        )}
      </div>
      <ul className={relationList({ isBullet })}>{children}</ul>
    </div>
  )
}

/** 相手を表示ID(番号だけでも可)で指定して、親 / 子 / 関連を追加する */
const AddRelationForm: FC<{ ticket: Ticket; refresh: () => Promise<void> }> = ({ ticket, refresh }) => {
  const { t } = useLocale()
  const [kind, setKind] = useState<TicketRelationKind>('child')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string>()
  const [isAdding, setAdding] = useState(false)
  const fetchCandidates = useCallback(
    (keyword: string) =>
      parseAction(searchRelationCandidates({ ticketId: ticket.id, keyword }), {
        handled: 'all',
      }),
    [ticket.id],
  )
  const { candidates, isSearching, activate } = useTicketCandidates(fetchCandidates, target)

  const kindOptions = Object.fromEntries(
    TICKET_RELATION_KINDS.map((item) => [item, t(TICKET_RELATION_KIND_LOCALE[item])]),
  )

  const add = async () => {
    const parsed = zRelationTarget.safeParse(target)
    if (!parsed.success) {
      setError(t('@relation_target_invalid'))
      return
    }
    setAdding(true)
    try {
      await parseAction(addTicketRelation({ ticketId: ticket.id, target: parsed.data, kind }), {
        handled: [RELATION_TARGET_INVALID, RELATION_ALREADY_EXISTS],
      })
      notify.success(t('msg_saved'))
      setTarget('')
      await refresh()
    } catch (e) {
      // 相手の指定に起因するものは入力欄に出す。それ以外は parseAction 側で通知済み
      if (e instanceof ClientError && e.errorType === RELATION_TARGET_INVALID) {
        setError(t('@relation_target_invalid'))
      } else if (e instanceof ClientError && e.errorType === RELATION_ALREADY_EXISTS) {
        setError(t('@relation_already_exists'))
      }
    } finally {
      setAdding(false)
    }
  }

  return (
    <form
      className='flex flex-wrap items-start gap-2'
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <div className='w-32 shrink-0'>
        <SingleSelectField
          isSmart
          isLabelHidden
          label={t('relation_filter')}
          triggerLabel={kindOptions[kind]}
          groupOptions={kindOptions}
          value={kind}
          onChange={(value) => setKind(TICKET_RELATION_KINDS.find((item) => item === value) ?? kind)}
        />
      </div>
      <div className='min-w-40 grow'>
        <TicketSelectField
          isSmart
          aria-label={t('search_ticket')}
          placeholder={t('search_ticket')}
          options={candidates}
          isLoading={isSearching}
          inputValue={target}
          onInputChange={(value) => {
            setTarget(value)
            setError(undefined)
          }}
          onSelect={(option) => {
            setTarget(option.displayId)
            setError(undefined)
          }}
          onSubmit={() => void add()}
          onFocus={activate}
          errorMessage={error}
        />
      </div>
      <MultiButton
        type='submit'
        size='sm'
        variant='outline'
        icon={<PlusIcon width={16} />}
        isPending={isAdding}
        isDisabled={!target.trim()}
      >
        {t('add_relation')}
      </MultiButton>
    </form>
  )
}

/** 子が次の順番へ進む条件。エージェントは前の順番の兄弟がこの条件を満たすまで子を拾わない */
const ChildAdvanceField: FC<{ ticket: Ticket; refresh: () => Promise<void> }> = ({ ticket, refresh }) => {
  const { t } = useLocale()
  const [isSaving, setSaving] = useState(false)
  const options = Object.fromEntries(TICKET_CHILD_ADVANCES.map((item) => [item, t(TICKET_CHILD_ADVANCE_LOCALE[item])]))

  if (!ticket.canEdit) {
    return (
      <div className='text-xs'>
        <span className='text-muted'>{t('child_advance')}: </span>
        {options[ticket.childAdvance]}
      </div>
    )
  }

  const change = async (next: string | null) => {
    const childAdvance = TICKET_CHILD_ADVANCES.find((item) => item === next)
    if (!childAdvance || childAdvance === ticket.childAdvance) {
      return
    }
    setSaving(true)
    try {
      await parseAction(patchTicket({ id: ticket.id, childAdvance }))
      notify.success(t('msg_saved'))
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='max-w-72'>
      <SingleSelectField
        isSmart
        label={t('child_advance')}
        groupOptions={options}
        value={ticket.childAdvance}
        isDisabled={isSaving}
        onChange={(next) => void change(next)}
      />
    </div>
  )
}

/** 親チケット・直下の子・関連チケット。参照は 1 階層だけ */
export const TicketRelations: FC<{ ticket: Ticket; refresh: () => Promise<void> }> = ({ ticket, refresh }) => {
  const { t } = useLocale()
  const { relations, canEdit, displayId } = ticket
  const { parent, children, childProgress, related } = relations
  const [moving, setMoving] = useState<{ relationId: string; offset: MoveOffset }>()

  const moveChild = async (child: ChildTicket, offset: MoveOffset) => {
    setMoving({ relationId: child.relationId, offset })
    try {
      await parseAction(moveTicketChild({ id: child.relationId, offset }))
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setMoving(undefined)
    }
  }

  // 編集できない人に空の見出しだけを見せても意味が無い
  if (!parent && children.length === 0 && related.length === 0 && !canEdit) {
    return null
  }

  return (
    <AccordionSection
      id='relations'
      icon={<LinkIcon />}
      title={`${t('ticket_relations')} (${(parent ? 1 : 0) + children.length + related.length})`}
    >
      <FlexCol isSmart>
        <RelationGroup title={t('parent_ticket')} isEmpty={!parent}>
          {parent && <RelationItem item={parent} canEdit={canEdit} refresh={refresh} />}
        </RelationGroup>

        <RelationGroup
          title={
            <>
              {t('child_tickets')}
              {childProgress.total > 0 && (
                <span className='ml-2 font-mono text-xs'>
                  {t('child_progress', { done: childProgress.done, total: childProgress.total })}
                </span>
              )}
            </>
          }
          listFilter={{ displayId, relation: 'child' }}
          isEmpty={children.length === 0}
          isBullet
        >
          {children.map((child, index) => (
            <RelationItem
              key={child.relationId}
              item={child}
              canEdit={canEdit}
              refresh={refresh}
              order={child.order}
              actions={
                <ChildMoveButtons
                  isFirst={index === 0}
                  isLast={index === children.length - 1}
                  moving={moving?.relationId === child.relationId ? moving.offset : undefined}
                  isLocked={moving !== undefined}
                  onMove={(offset) => void moveChild(child, offset)}
                />
              }
            />
          ))}
        </RelationGroup>

        {children.length > 0 && <ChildAdvanceField ticket={ticket} refresh={refresh} />}

        <RelationGroup
          title={`${t('related_tickets')} (${related.length})`}
          listFilter={{ displayId, relation: 'related' }}
          isEmpty={related.length === 0}
          isBullet
        >
          {related.map((item) => (
            <RelationItem key={item.relationId} item={item} canEdit={canEdit} refresh={refresh} />
          ))}
        </RelationGroup>

        {canEdit && <AddRelationForm ticket={ticket} refresh={refresh} />}
      </FlexCol>
    </AccordionSection>
  )
}
