'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { ContentHeader } from '@/components/header'
import {
  ArrowLeftCircleIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  Cog6ToothIcon,
  TagIcon,
  TrashIcon,
  UserGroupIcon,
  UsersIcon,
  ViewColumnsIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { TagEditor } from '@/components/ticket/tag-editor'
import { useBoardName } from '@/components/ticket/ticket-chip'
import { parseAction, useActionData } from '@/lib/action-client'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Chip, Skeleton } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, ReactNode } from 'react'
import { BoardProfile } from './board-profile'
import { GroupManage, MemberManage } from './member-manage'
import {
  createBoardTag,
  deleteBoard,
  deleteBoardTag,
  getBoardAssignments,
  getBoardDetail,
  getBoardTags,
  mergeBoardTags,
  updateBoardTag,
} from './server'

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
  const router = useRouter()
  const boardName = useBoardName()
  const { confirmModal } = useConfirmModal()

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
  const canManageBoard = !isPrivate && board.canManage

  // ボード削除は配下のチケット / コメントごと消えるので、ボード名入りの専用確認文をチェック付きで出す
  const removeBoard = async () => {
    const name = boardName(board)
    try {
      const ok = await confirmModal().confirm({
        title: t('confirm_deletion'),
        text: t('msg_confirm_delete_board', { target: name }),
        requireCheck: true,
        autoClose: false,
      })
      if (ok) {
        await parseAction(deleteBoard({ id: board.id }))
        notify.success(t('msg_deleted_target', { target: name }))
        router.push('/boards')
      }
    } finally {
      confirmModal().close()
    }
  }

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
        {canManageBoard && (
          <MultiButton isIconOnly variant='danger-soft' tooltip={t('delete')} onPress={removeBoard}>
            <ButtonGroup.Separator />
            <TrashIcon />
          </MultiButton>
        )}
      </ContentHeader>

      <BoardProfile board={board} reload={reload} />

      {/* プライベートボードは 1 ユーザー 1 つの固定構成なのでアサインを変更させない */}
      {canManageBoard && assignments && (
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
