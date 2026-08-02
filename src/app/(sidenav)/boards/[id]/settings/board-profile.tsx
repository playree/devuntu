'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxCtrl } from '@/components/general/checkbox-ctrl'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { StatusChip } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { scUpdateBoard, UpdateBoard } from '@/lib/schema'
import { TICKET_STATUSES } from '@/lib/task'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { GetBoardDetailReturnType, updateBoard } from './server'

type Board = NonNullable<GetBoardDetailReturnType>

/** 見出し + 値の 1 行 */
const MetaRow: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className='flex items-baseline gap-2'>
    <span className='w-24 shrink-0 text-xs text-gray-500'>{label}</span>
    <div className='min-w-0 text-sm'>{children}</div>
  </div>
)

/** 名前 / 説明 / アーカイブの編集フォーム。team ボードの owner(または管理者)だけに出す */
const EditForm: FC<{ board: Board; reload: () => void }> = ({ board, reload }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<UpdateBoard>({
    resolver: zodResolver(scUpdateBoard),
    mode: 'onChange',
    defaultValues: {
      id: board.id,
      name: board.name,
      description: board.description,
      archived: board.archived,
    },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(updateBoard(req))
        notify.success(t('msg_saved'))
        // 再取得しても useForm の defaultValues は追従しないので、保存値で dirty を落としておく
        reset(req)
        reload()
      })}
    >
      <GridBox>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='name'
            constraintSchema={scUpdateBoard}
            label={t('name')}
            errorMessage={fet(errors.name)}
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='description'
            constraintSchema={scUpdateBoard}
            label={t('description')}
            errorMessage={fet(errors.description)}
          />
        </div>
        <div className='col-span-12 flex items-center gap-2'>
          <CheckBoxCtrl control={control} variant='secondary' name='archived' id='archived' label={t('archived')} />
          <MultiButton className='ml-auto' type='submit' size='sm' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </GridBox>
    </form>
  )
}

/**
 * ボードの概要ブロック。
 * 名前 / 説明 / アーカイブは編集権限があればそのまま編集でき、それ以外は読み取り表示になる。
 */
export const BoardProfile: FC<{ board: Board; reload: () => void }> = ({ board, reload }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()

  const isPrivate = board.kind === 'private'
  // プライベートボードは 1 ユーザー 1 つの固定構成なので編集させない(updateBoard 側も assertTeamBoard で弾く)
  const canEdit = !isPrivate && board.canManage
  const totalTickets = TICKET_STATUSES.reduce((sum, status) => sum + board.ticketCounts[status], 0)

  return (
    <div className='space-y-1 rounded-xl border-2 p-3'>
      <MetaRow label={t('board')}>{isPrivate ? t('private') : t('team')}</MetaRow>
      <MetaRow label={t('owner')}>
        <Chip variant='soft' color={board.role === 'owner' ? 'accent' : 'default'} size='sm'>
          <Chip.Label>{board.role === 'owner' ? t('owner') : t('member')}</Chip.Label>
        </Chip>
      </MetaRow>
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

      {canEdit ? (
        <div className='pt-2'>
          <EditForm board={board} reload={reload} />
        </div>
      ) : (
        <>
          {!isPrivate && <MetaRow label={t('description')}>{board.description || '-'}</MetaRow>}
          <MetaRow label={t('archived')}>{board.archived ? t('archived') : '-'}</MetaRow>
        </>
      )}
    </div>
  )
}
