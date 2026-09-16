'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { useConfirmModal, useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { NoticePanel, Panel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowLeftCircleIcon, Cog6ToothIcon, CommandLineIcon, UsersIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { RoleChip } from '@/components/role-chip'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { SESSION_NOT_FRESH } from '@/lib/auth/auth-config'
import { useReAuth } from '@/lib/auth/use-re-auth'
import { COMMAND_DEF_CONFLICT, COMMAND_DEF_NOT_EDITABLE, COMMAND_DEF_READ_ONLY } from '@/lib/command/command'
import { ClientError, TOO_MANY_REQUESTS } from '@/lib/error'
import { useLocale } from '@/locale/client'
import { Accordion, Chip } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { CommandDefs } from './command-defs'
import { CommandDefModal, type CommandDefTarget } from './def-modal'
import {
  type CommandDefView,
  deleteCommandDefAction,
  getCommandTargetDetailAction,
  getCommandTargetMembersAction,
} from './server'
import { TargetMembers } from './target-members'

const defaultExpandedKeys = new Set(['command_definition'])

/**
 * ターゲット設定。
 *
 * 見られるのはアサインされたユーザーだけで、コマンド定義を編集できるのはオーナーだけ。
 * アサインそのものの変更は管理者の領分なので、この画面には導線を置かない。
 */
export const CommandTargetClient: FC<{ targetKey: string }> = ({ targetKey }) => {
  const { t } = useLocale()
  const router = useRouter()
  const reAuth = useReAuth()
  const { data, isLoading, reload } = useActionData(() => getCommandTargetDetailAction({ targetKey }))
  const defModalState = useModalState<CommandDefTarget>()
  const { confirmModal } = useConfirmModal()

  const memberList = usePagingList({
    load: async () => (await parseAction(getCommandTargetMembersAction({ targetKey }))) ?? [],
    sort: { init: { column: 'name', direction: 'ascending' } },
  })

  const deleteDef = async (command: CommandDefView) => {
    if (!data) {
      return
    }
    const ok = await confirmModal().confirm({
      title: t('command_def_delete'),
      text: t('command_def_delete_confirm'),
    })
    if (!ok) {
      return
    }
    try {
      const result = await parseAction(
        deleteCommandDefAction({ targetKey, revision: data.target.revision, commandId: command.id }),
      )
      if (!result?.ok) {
        notify.error(t('error'), { description: result?.messages.join(' / ') })
        return
      }
      notify.success(t('msg_saved'))
    } catch (e) {
      if (!(e instanceof ClientError)) {
        throw e
      }
      switch (e.errorType) {
        case COMMAND_DEF_CONFLICT:
          notify.warn(t('command_def_conflict'))
          break
        case COMMAND_DEF_NOT_EDITABLE:
          notify.warn(t('command_def_not_editable'))
          break
        case COMMAND_DEF_READ_ONLY:
          notify.warn(t('command_def_read_only'))
          break
        case TOO_MANY_REQUESTS:
          notify.warn(t('msg_too_many_requests'))
          break
        case SESSION_NOT_FRESH:
          await reAuth()
          return
        default:
          throw e
      }
    }
    await reload()
  }

  if (isLoading && !data) {
    return <PanelSkeleton />
  }

  // parseAction は ClientError を notify せず throw するため、ここで明示的に表示する
  if (!data) {
    return (
      <FlexCol>
        <ContentHeader icon={<Cog6ToothIcon />} title={t('command_target_settings')}>
          <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/commands')}>
            <ArrowLeftCircleIcon />
          </MultiButton>
        </ContentHeader>
        <NoticePanel>{t('msg_no_access')}</NoticePanel>
      </FlexCol>
    )
  }

  return (
    <FlexCol>
      <ContentHeader icon={<Cog6ToothIcon />} title={data.target.label}>
        <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/commands')}>
          <ArrowLeftCircleIcon />
        </MultiButton>
      </ContentHeader>

      <Panel>
        <FlexRow className='flex-wrap items-center'>
          <span className='text-foreground-500 font-mono text-xs'>{data.target.id}</span>
          <span className='grow' />
          <RoleChip role={data.role} />
          {/* 編集の導線が出ない理由(editable か書き込み可否)が画面から分かるようにする */}
          {data.target.editable && (
            <Chip variant='soft' className='whitespace-nowrap'>
              {t('command_target_editable')}
            </Chip>
          )}
        </FlexRow>
        {data.role === 'owner' && !data.target.editable && (
          <NoticePanel className='mt-2 text-xs'>{t('command_def_not_editable')}</NoticePanel>
        )}
        {data.role === 'owner' && data.target.editable && !data.writable && (
          <NoticePanel className='mt-2 text-xs' status='warning'>
            {t('command_def_read_only')}
          </NoticePanel>
        )}
      </Panel>

      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='command_definition' icon={<CommandLineIcon />} title={t('command_definition')}>
          <CommandDefs
            commands={data.commands}
            canEdit={data.canEditDef}
            onAdd={() =>
              defModalState.open({
                targetKey,
                revision: data.target.revision,
                targetLabel: data.target.label,
                command: null,
              })
            }
            onEdit={(command) =>
              defModalState.open({
                targetKey,
                revision: data.target.revision,
                targetLabel: data.target.label,
                command,
              })
            }
            onDelete={deleteDef}
          />
        </AccordionSection>

        <AccordionSection id='command_target_members' icon={<UsersIcon />} title={t('command_target_members')}>
          <TargetMembers pagingList={memberList} />
        </AccordionSection>
      </Accordion>

      {defModalState.target && (
        <CommandDefModal state={defModalState} reload={reload} key={defModalState.key} target={defModalState.target} />
      )}
    </FlexCol>
  )
}
