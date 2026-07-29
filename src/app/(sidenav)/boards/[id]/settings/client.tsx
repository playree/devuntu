'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { ContentHeader } from '@/components/header'
import {
  ArrowLeftCircleIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  Cog6ToothIcon,
  TagIcon,
  UserGroupIcon,
  UsersIcon,
  ViewColumnsIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { TagEditor } from '@/components/ticket/tag-editor'
import { StatusChip, useBoardName } from '@/components/ticket/ticket-chip'
import { parseAction, useActionData } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { TICKET_STATUSES } from '@/lib/task'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Chip, Skeleton } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, ReactNode } from 'react'
import { GroupManage, MemberManage } from './member-manage'
import {
  createBoardTag,
  deleteBoardTag,
  getBoardAssignments,
  getBoardDetail,
  getBoardTags,
  mergeBoardTags,
  updateBoardTag,
} from './server'

/** 見出し + 値の 1 行 */
const MetaRow: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className='flex items-baseline gap-2'>
    <span className='w-24 shrink-0 text-xs text-gray-500'>{label}</span>
    <div className='min-w-0 text-sm'>{children}</div>
  </div>
)

/** アイコン付きのセクション見出し */
const Section: FC<{ icon: ReactNode; title: string; children: ReactNode }> = ({ icon, title, children }) => (
  <fieldset className='rounded-xl border-2 p-3'>
    <legend className='flex items-center gap-1 px-2 text-sm text-gray-500'>
      {icon}
      {title}
    </legend>
    {children}
  </fieldset>
)

export const BoardSettingsClient: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const router = useRouter()
  const boardName = useBoardName()

  const { data: board, reload, isLoading } = useActionData(() => getBoardDetail({ id: boardId }))
  const { data: tags, reload: reloadTags } = useActionData(() => getBoardTags({ id: boardId }))
  // アサイン編集は manage 権限が要るため、取得できない場合は undefined のまま(セクションを出さない)
  const { data: assignments, reload: reloadAssignments } = useActionData(() => getBoardAssignments({ id: boardId }))

  if (isLoading) {
    return <Skeleton className='min-h-48 w-full rounded-xl' />
  }

  // parseAction は ClientError を notify せず throw するため、ここで明示的に表示する
  if (!board) {
    return (
      <FlexCol>
        <ContentHeader icon={<Cog6ToothIcon />} title={t('board_settings')}>
          <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/boards')}>
            <ArrowLeftCircleIcon />
          </MultiButton>
        </ContentHeader>
        <div className='rounded-xl border-2 p-4 text-sm'>{t('msg_no_access')}</div>
      </FlexCol>
    )
  }

  const isPrivate = board.kind === 'private'
  const totalTickets = TICKET_STATUSES.reduce((sum, status) => sum + board.ticketCounts[status], 0)

  return (
    <FlexCol>
      <ContentHeader icon={<Cog6ToothIcon />} title={boardName(board)}>
        <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/boards')}>
          <ArrowLeftCircleIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('kanban')} onPress={() => router.push(`/boards/${board.id}`)}>
          <ButtonGroup.Separator />
          <ViewColumnsIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('ticket')} onPress={() => router.push(`/tickets?boardId=${board.id}`)}>
          <ButtonGroup.Separator />
          <ArrowTopRightOnSquareIcon />
        </MultiButton>
        <MultiButton
          isIconOnly
          tooltip={t('reload')}
          onPress={() => {
            reload()
            reloadTags()
            reloadAssignments()
          }}
        >
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <div className='space-y-1 rounded-xl border-2 p-3'>
        <MetaRow label={t('board')}>{isPrivate ? t('private') : t('team')}</MetaRow>
        {!isPrivate && <MetaRow label={t('description')}>{board.description || '-'}</MetaRow>}
        <MetaRow label={t('owner')}>
          <Chip variant='soft' color={board.role === 'owner' ? 'accent' : 'default'} size='sm'>
            <Chip.Label>{board.role === 'owner' ? t('owner') : t('member')}</Chip.Label>
          </Chip>
        </MetaRow>
        <MetaRow label={t('archived')}>{board.archived ? t('archived') : '-'}</MetaRow>
        <MetaRow label={t('ticket_count')}>
          <div className='flex flex-wrap items-center gap-1'>
            <span className='font-mono text-xs'>{totalTickets}</span>
            {TICKET_STATUSES.filter((status) => board.ticketCounts[status] > 0).map((status) => (
              <span key={status} className='flex items-center gap-0.5'>
                <StatusChip status={status} />
                <span className='font-mono text-xs'>{board.ticketCounts[status]}</span>
              </span>
            ))}
          </div>
        </MetaRow>
        <MetaRow label={t('created_at')}>
          <span className='font-mono text-xs'>{dayformat(board.createdAt, 'tz-simple', tz)}</span>
        </MetaRow>
      </div>

      {/* プライベートボードは 1 ユーザー 1 つの固定構成なのでアサインを変更させない */}
      {!isPrivate && board.canManage && assignments && (
        <Section icon={<UsersIcon width={16} />} title={t('board_members')}>
          <MemberManage boardId={board.id} assignments={assignments} reload={reloadAssignments} />
        </Section>
      )}

      {!isPrivate && board.isAdmin && assignments && (
        <Section icon={<UserGroupIcon width={16} />} title={t('board_groups')}>
          <GroupManage boardId={board.id} assignments={assignments} reload={reloadAssignments} />
        </Section>
      )}

      {!isPrivate && (
        <Section icon={<UsersIcon width={16} />} title={t('member_count')}>
          <div className='flex flex-wrap gap-1'>
            {board.members.map((member) => (
              <Chip key={member.id} variant='tertiary' size='sm'>
                <Chip.Label>
                  {member.name}
                  {member.role === 'owner' ? ` (${t('owner')})` : member.via === 'group' ? ` (${t('group')})` : ''}
                </Chip.Label>
              </Chip>
            ))}
          </div>
        </Section>
      )}

      <Section icon={<TagIcon width={16} />} title={t('tag_manage')}>
        <TagEditor
          tags={tags ?? []}
          canManage={board.canManage}
          onCreate={async (req) => {
            await parseAction(createBoardTag({ boardId: board.id, ...req }))
            notify.success(t('msg_added_target', { target: req.name }))
            reloadTags()
          }}
          onUpdate={async (req) => {
            await parseAction(updateBoardTag(req))
            notify.success(t('msg_updated_target', { target: req.name }))
            reloadTags()
          }}
          onDelete={async (tag) => {
            await parseAction(deleteBoardTag({ id: tag.id }))
            reloadTags()
          }}
          onMerge={async (req) => {
            await parseAction(mergeBoardTags({ boardId: board.id, ...req }))
            reloadTags()
          }}
        />
      </Section>
    </FlexCol>
  )
}
