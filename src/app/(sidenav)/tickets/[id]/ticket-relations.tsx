'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { InputField } from '@/components/general/input'
import { SingleSelectField } from '@/components/general/select'
import { LinkIcon, PlusIcon, XMarkIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { StatusChip, TicketIdText } from '@/components/ticket/ticket-chip'
import { TicketSelectField } from '@/components/ticket/ticket-select'
import { parseAction } from '@/lib/action/action-client'
import {
  MAX_CHILD_ORDER,
  relatedTicketListPath,
  RELATION_ALREADY_EXISTS,
  RELATION_TARGET_INVALID,
  TICKET_RELATION_KIND_LOCALE,
  TICKET_RELATION_KINDS,
  type TicketRelationFilter,
  type TicketRelationKind,
} from '@/lib/board/ticket-relation-rule'
import { ClientError } from '@/lib/error'
import { zChildOrder, zRelationTarget } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import Link from 'next/link'
import { FC, ReactNode, useEffect, useState } from 'react'
import {
  addTicketRelation,
  GetTicketReturnType,
  type RelationCandidate,
  removeTicketRelation,
  searchRelationCandidates,
  updateTicketChildOrder,
} from './server'

/** 候補検索を始めるまでの入力待ち */
const SEARCH_DEBOUNCE_MS = 300

type Ticket = NonNullable<GetTicketReturnType>
type Relations = Ticket['relations']
type RelatedTicket = Relations['related'][number]
type ChildTicket = Relations['children'][number]

/** 子の順番の入力欄。確定(Enter / フォーカスを外す)したときだけ保存する */
const ChildOrderInput: FC<{ child: ChildTicket; refresh: () => Promise<void> }> = ({ child, refresh }) => {
  const { t } = useLocale()
  const [value, setValue] = useState(String(child.order))
  const [isSaving, setSaving] = useState(false)

  const save = async () => {
    const parsed = zChildOrder.safeParse(Number(value))
    if (!parsed.success || parsed.data === child.order) {
      setValue(String(child.order))
      return
    }
    setSaving(true)
    try {
      await parseAction(updateTicketChildOrder({ id: child.relationId, order: parsed.data }))
      await refresh()
    } catch {
      setValue(String(child.order))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='w-16 shrink-0'>
      <InputField
        isSmart
        isLabelHidden
        type='number'
        label={t('child_order')}
        aria-label={t('child_order')}
        min={1}
        max={MAX_CHILD_ORDER}
        value={value}
        disabled={isSaving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

/** 関係の相手 1 件。左端(prefix)には子の順番を置ける */
const RelationItem: FC<{
  item: RelatedTicket
  canEdit: boolean
  refresh: () => Promise<void>
  prefix?: ReactNode
}> = ({ item, canEdit, refresh, prefix }) => {
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
    <li className='flex items-center gap-2'>
      {prefix}
      <div className='flex min-w-0 grow flex-wrap items-center gap-x-2 gap-y-0.5'>
        <TicketIdText displayId={item.displayId} className='shrink-0' />
        <Link href={`/tickets/${item.id}`} className='min-w-0 truncate text-sm hover:underline'>
          {item.title}
        </Link>
        <StatusChip value={item.status} />
        {item.assigneeName && <span className='text-muted truncate text-xs'>{item.assigneeName}</span>}
      </div>
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
    </li>
  )
}

/** 親 / 子 / 関連の見出し付きの一覧。空なら `-` を出す */
const RelationGroup: FC<{
  title: ReactNode
  /** チケット一覧で開くときの絞り込み。親は 1 件だけなので渡さない */
  listFilter?: { displayId: string; relation: TicketRelationFilter }
  isEmpty: boolean
  children: ReactNode
}> = ({ title, listFilter, isEmpty, children }) => {
  const { t } = useLocale()
  return (
    <div className='space-y-1'>
      <div className='flex items-center gap-2 text-sm'>
        <span className='text-muted'>{title}</span>
        {listFilter && !isEmpty && (
          <Link
            href={relatedTicketListPath(listFilter.displayId, listFilter.relation)}
            className='text-muted text-xs underline-offset-2 hover:underline'
          >
            {t('show_in_ticket_list')}
          </Link>
        )}
      </div>
      {isEmpty ? <div className='text-muted pl-2 text-sm'>-</div> : <ul className='space-y-1 pl-2'>{children}</ul>}
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
  const [candidates, setCandidates] = useState<RelationCandidate[]>([])
  const [isSearching, setSearching] = useState(false)

  // 入力が落ち着いてから候補を引き直す。後から届いた古い応答で候補を上書きしないよう、打ち切った検索の結果は捨てる
  useEffect(() => {
    let isCurrent = true
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const result = await parseAction(searchRelationCandidates({ ticketId: ticket.id, keyword: target }), {
          handled: 'all',
        })
        if (isCurrent) {
          setCandidates(result)
        }
      } catch {
        if (isCurrent) {
          setCandidates([])
        }
      } finally {
        if (isCurrent) {
          setSearching(false)
        }
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      isCurrent = false
      clearTimeout(timer)
    }
  }, [ticket.id, target])

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

/** 親チケット・直下の子・関連チケット。参照は 1 階層だけ */
export const TicketRelations: FC<{ ticket: Ticket; refresh: () => Promise<void> }> = ({ ticket, refresh }) => {
  const { t } = useLocale()
  const { relations, canEdit, displayId } = ticket
  const { parent, children, childProgress, related } = relations

  // 編集できない人に空の見出しだけを見せても意味が無い
  if (!parent && children.length === 0 && related.length === 0 && !canEdit) {
    return null
  }

  return (
    <FlexCol isSmart className='pb-4'>
      <div className='flex items-center gap-2'>
        <LinkIcon />
        <span>{t('ticket_relations')}</span>
      </div>

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
      >
        {children.map((child) => (
          <RelationItem
            key={child.relationId}
            item={child}
            canEdit={canEdit}
            refresh={refresh}
            prefix={
              canEdit ? (
                <ChildOrderInput key={child.order} child={child} refresh={refresh} />
              ) : (
                <span className='text-muted w-6 shrink-0 text-right font-mono text-xs'>{child.order}</span>
              )
            }
          />
        ))}
      </RelationGroup>

      <RelationGroup
        title={`${t('related_tickets')} (${related.length})`}
        listFilter={{ displayId, relation: 'related' }}
        isEmpty={related.length === 0}
      >
        {related.map((item) => (
          <RelationItem key={item.relationId} item={item} canEdit={canEdit} refresh={refresh} />
        ))}
      </RelationGroup>

      {canEdit && <AddRelationForm ticket={ticket} refresh={refresh} />}
    </FlexCol>
  )
}
