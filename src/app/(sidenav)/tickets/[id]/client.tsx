'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal, useModalState } from '@/components/general/modal'
import { ContentHeader } from '@/components/header'
import { ArrowLeftCircleIcon, ArrowPathIcon, PencilSquareIcon, TicketIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { MarkdownView } from '@/components/ticket/markdown-view'
import { PriorityChip, StatusChip, TagChips, useBoardName, useTicketOptions } from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Label, ListBox, Select, Skeleton } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'
import {
  createTicketTag,
  deleteTicket,
  getAssigneeOptions,
  getTicketFormOptions,
  GetTicketFormOptionsReturnType,
} from '../server'
import { TicketComments } from './comments'
import { UpdateModal } from './modals'
import { getTicket, updateTicketStatus } from './server'

/** 見出し + 値の 1 行 */
const MetaRow: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className='flex items-baseline gap-2'>
    <span className='w-20 shrink-0 text-xs text-gray-500'>{label}</span>
    <div className='min-w-0 text-sm'>{children}</div>
  </div>
)

export const TicketDetailClient: FC<{ id: string }> = ({ id }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const router = useRouter()
  const { confirmModal } = useConfirmModal()
  const { statusOptions } = useTicketOptions()
  const boardName = useBoardName()
  const updateModalState = useModalState()

  const { data: ticket, reload, isLoading } = useActionData(() => getTicket({ id }))
  const [options, setOptions] = useState<GetTicketFormOptionsReturnType>()
  const [boardAssignees, setBoardAssignees] = useState<Record<string, string>>({})
  const [isMovingStatus, setMovingStatus] = useState(false)

  useEffect(() => {
    parseAction(getTicketFormOptions())
      .then(setOptions)
      .catch(() => setOptions(undefined))
  }, [])

  // 担当者候補はそのボードのメンバー(プライベートボードなら本人のみ)
  const boardId = ticket?.boardId
  useEffect(() => {
    if (!boardId) {
      return
    }
    parseAction(getAssigneeOptions({ id: boardId }))
      .then((res) => setBoardAssignees(res ?? {}))
      .catch(() => setBoardAssignees({}))
  }, [boardId])

  const changeStatus = async (status: TicketStatus) => {
    setMovingStatus(true)
    try {
      await parseAction(updateTicketStatus({ id, status }))
      notify.success(t('msg_saved'))
      reload()
    } finally {
      setMovingStatus(false)
    }
  }

  const remove = async () => {
    if (!ticket) {
      return
    }
    try {
      const ok = await confirmModal().confirm({
        title: t('confirm_deletion'),
        text: t('msg_confirm_deletion', { target: ticket.title }),
        requireCheck: true,
        autoClose: false,
      })
      if (ok) {
        await parseAction(deleteTicket({ id }))
        notify.success(t('msg_deleted_target', { target: ticket.title }))
        router.push('/tickets')
      }
    } finally {
      confirmModal().close()
    }
  }

  if (isLoading) {
    return <Skeleton className='min-h-48 w-full rounded-xl' />
  }

  // parseAction は ClientError を notify せず throw するため、ここで明示的に表示する
  if (!ticket) {
    return (
      <FlexCol>
        <ContentHeader icon={<TicketIcon />} title={t('ticket')}>
          <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/tickets')}>
            <ArrowLeftCircleIcon />
          </MultiButton>
        </ContentHeader>
        <div className='rounded-xl border-2 p-4 text-sm'>{t('msg_no_access')}</div>
      </FlexCol>
    )
  }

  return (
    <FlexCol>
      <ContentHeader icon={<TicketIcon />} title={ticket.title}>
        <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/tickets')}>
          <ArrowLeftCircleIcon />
        </MultiButton>
        {ticket.canEdit && (
          <MultiButton isIconOnly tooltip={t('update')} isDisabled={!options} onPress={() => updateModalState.open()}>
            <ButtonGroup.Separator />
            <PencilSquareIcon />
          </MultiButton>
        )}
        {ticket.canDelete && (
          <MultiButton isIconOnly variant='danger-soft' tooltip={t('delete')} onPress={remove}>
            <TrashIcon />
          </MultiButton>
        )}
        <MultiButton isIconOnly tooltip={t('reload')} onPress={reload}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <div className='grid grid-cols-12 gap-2'>
        <div className='col-span-12 space-y-1 rounded-xl border-2 p-3 md:col-span-5'>
          <MetaRow label={t('board')}>{boardName({ name: ticket.boardName, kind: ticket.boardKind })}</MetaRow>
          <MetaRow label={t('status')}>
            {ticket.canEdit ? (
              <Select
                selectionMode='single'
                variant='secondary'
                value={ticket.status}
                isDisabled={isMovingStatus}
                onChange={(key) => {
                  const next = key?.toString() as TicketStatus | undefined
                  if (next && next !== ticket.status) {
                    changeStatus(next)
                  }
                }}
              >
                <Label className='sr-only'>{t('status')}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox selectionMode='single'>
                    {Object.entries(statusOptions).map(([value, name]) => (
                      <ListBox.Item key={value} id={value} textValue={name}>
                        {name}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            ) : (
              <StatusChip status={ticket.status} />
            )}
          </MetaRow>
          <MetaRow label={t('priority')}>{ticket.priority ? <PriorityChip priority={ticket.priority} /> : '-'}</MetaRow>
          <MetaRow label={t('assignee')}>{ticket.assigneeName || t('unassigned')}</MetaRow>
          <MetaRow label={t('due_date')}>
            <span className='font-mono text-xs'>{dayformat(ticket.dueDate, 'date') || '-'}</span>
          </MetaRow>
          <MetaRow label={t('tags')}>{ticket.tags.length > 0 ? <TagChips tags={ticket.tags} /> : '-'}</MetaRow>
          <MetaRow label={t('created_at')}>
            <span className='font-mono text-xs'>{dayformat(ticket.createdAt, 'tz-simple', tz)}</span>
            {ticket.createdByName && <span className='ml-2 text-xs text-gray-500'>{ticket.createdByName}</span>}
          </MetaRow>
          <MetaRow label={t('updated_at')}>
            <span className='font-mono text-xs'>{dayformat(ticket.updatedAt, 'tz-simple', tz)}</span>
          </MetaRow>
        </div>

        <fieldset className='col-span-12 min-h-48 rounded-xl border-2 p-3 md:col-span-7'>
          <legend className='px-2 text-sm text-gray-500'>{t('content')}</legend>
          <MarkdownView body={ticket.content ?? ''} />
        </fieldset>
      </div>

      <TicketComments ticket={ticket} reload={reload} />

      {updateModalState.isOpen && options && (
        <UpdateModal
          state={updateModalState}
          reload={reload}
          key={updateModalState.key}
          target={ticket}
          assigneeOptions={boardAssignees}
          // そのボードのタグだけを候補にする(他ボードのタグはサーバー側で弾かれる)
          tagOptions={options.tags.filter((tag) => tag.boardId === ticket.boardId)}
          onCreateTag={async (name) => parseAction(createTicketTag({ boardId: ticket.boardId, name }))}
        />
      )}
    </FlexCol>
  )
}
