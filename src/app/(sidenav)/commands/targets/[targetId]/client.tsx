'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { useConfirmModal, useModalState } from '@/components/general/modal'
import { NoticePanel, Panel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowLeftCircleIcon, Cog6ToothIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { RoleChip } from '@/components/role-chip'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { SESSION_NOT_FRESH } from '@/lib/auth/auth-config'
import { useReAuth } from '@/lib/auth/use-re-auth'
import { COMMAND_DEF_CONFLICT, COMMAND_DEF_NOT_EDITABLE, COMMAND_DEF_READ_ONLY } from '@/lib/command/command'
import { ClientError, TOO_MANY_REQUESTS } from '@/lib/error'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'
import { CommandDefs } from './command-defs'
import { CommandDefModal, type CommandDefTarget } from './def-modal'
import {
  checkCommandDefEditableAction,
  type CommandDefView,
  deleteCommandDefAction,
  getCommandTargetDetailAction,
} from './server'

/**
 * ターゲット設定。
 *
 * 見られるのはアサインされたユーザーだけで、コマンド定義を編集できるのはオーナーだけ。
 */
export const CommandTargetClient: FC<{ targetKey: string }> = ({ targetKey }) => {
  const { t } = useLocale()
  const router = useRouter()
  const reAuth = useReAuth()
  const { data, isLoading, reload } = useActionData(() => getCommandTargetDetailAction({ targetKey }))
  const defModalState = useModalState<CommandDefTarget>()
  const { confirmModal } = useConfirmModal()
  const [checking, setChecking] = useState<{ commandId: string | null } | null>(null)

  /**
   * 編集モーダルは、書き換えてよい相手かをサーバーへ確かめてから開く。
   *
   * 保存時に再認証を求められると画面を離れることになり、書いた内容が失われる。
   * 連打で `reAuth` が二重に走ると確認モーダルが使用中で落ちるため、確認中は弾く。
   */
  const openDefModal = async (command: CommandDefView | null) => {
    if (!data || checking) {
      return
    }
    setChecking({ commandId: command?.id ?? null })
    try {
      await parseAction(checkCommandDefEditableAction({ targetKey }), 0)
    } catch (e) {
      if (!(e instanceof ClientError)) {
        throw e
      }
      if (e.errorType === SESSION_NOT_FRESH) {
        await reAuth()
        return
      }
      // 権限やカタログの状態が変わっている。開かずに読み直す
      notify.warn(t('command_def_not_editable'))
      await reload()
      return
    } finally {
      setChecking(null)
    }
    defModalState.open({
      targetKey,
      revision: data.target.revision,
      targetLabel: data.target.label,
      command,
    })
  }

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

      <CommandDefs
        commands={data.commands}
        canEdit={data.canEditDef}
        checking={checking}
        onAdd={() => {
          void openDefModal(null)
        }}
        onEdit={(command) => {
          void openDefModal(command)
        }}
        onDelete={deleteDef}
      />

      {defModalState.target && (
        <CommandDefModal state={defModalState} reload={reload} key={defModalState.key} target={defModalState.target} />
      )}
    </FlexCol>
  )
}
