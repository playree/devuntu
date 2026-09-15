'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal, useModalState } from '@/components/general/modal'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CommandLineIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { SESSION_NOT_FRESH } from '@/lib/auth/auth-config'
import { useReAuth } from '@/lib/auth/use-re-auth'
import { COMMAND_DEF_CONFLICT, COMMAND_DEF_NOT_EDITABLE, COMMAND_DEF_READ_ONLY } from '@/lib/command/command'
import { type CommandTargetStatus } from '@/lib/command/command-catalog'
import { dayformat } from '@/lib/day'
import { ClientError, TOO_MANY_REQUESTS } from '@/lib/error'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { CommandDefTable, CommandTargetTable } from './command-tables'
import { CommandDefModal, type CommandDefTarget } from './def-modal'
import { SettingModal } from './modals'
import {
  type CommandDefView,
  deleteCommandDefAction,
  getCommandDefsAction,
  type GetCommandDefsReturnType,
  reloadCommandDefsAction,
} from './server'

/**
 * コマンド管理
 *
 * 定義そのものはサーバー上の YAML が持つ。この画面で編集できるのは
 * 有効化・許可グループ・表示順だけで、実行先や引数は画面から作れない。
 */
export const AdminCommandsClient: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { data, isLoading, refresh } = useActionData(getCommandDefsAction)
  const settingModalState = useModalState<CommandDefView>()
  const defModalState = useModalState<CommandDefTarget>()
  const { confirmModal } = useConfirmModal()
  const reAuth = useReAuth()

  /** 定義そのものの削除。設定行も一緒に消えるので、そのことを確認文で伝える */
  const deleteDef = async (command: CommandDefView) => {
    const ok = await confirmModal().confirm({
      title: t('command_def_delete'),
      text: t('command_def_delete_confirm'),
    })
    if (!ok) {
      return
    }
    try {
      const result = await parseAction(
        deleteCommandDefAction({ fileName: command.fileName, revision: command.revision, commandId: command.id }),
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
    await refresh()
  }

  return (
    <FlexCol>
      <ContentHeader icon={<CommandLineIcon />} title={t('command_manage')}>
        <MultiButton
          isIconOnly
          tooltip={t('command_def_reload')}
          coolTime={3}
          onPress={async () => {
            // 押したプロセスに即時反映させ、表示はいつもの取得経路で描き直す
            await parseAction(reloadCommandDefsAction())
            await refresh()
          }}
        >
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      {isLoading && !data ? (
        <PanelSkeleton />
      ) : (
        <CommandDefsBody
          data={data}
          tz={tz}
          onEdit={(command) => settingModalState.open(command)}
          onEditDef={(command) =>
            defModalState.open({
              fileName: command.fileName,
              revision: command.revision,
              targetLabel: command.targetLabel ?? '',
              command,
            })
          }
          onDeleteDef={deleteDef}
          onAdd={(target) =>
            defModalState.open({
              fileName: target.fileName,
              revision: target.revision,
              targetLabel: target.label,
              command: null,
            })
          }
        />
      )}

      {settingModalState.target && (
        <SettingModal
          state={settingModalState}
          reload={refresh}
          key={settingModalState.key}
          target={settingModalState.target}
          groupOptions={data?.groupOptions ?? {}}
        />
      )}

      {defModalState.target && (
        <CommandDefModal state={defModalState} reload={refresh} key={defModalState.key} target={defModalState.target} />
      )}
    </FlexCol>
  )
}

const CommandDefsBody: FC<{
  data: GetCommandDefsReturnType
  tz: string
  onEdit: (command: CommandDefView) => void
  onEditDef: (command: CommandDefView) => void
  onDeleteDef: (command: CommandDefView) => void
  onAdd: (target: CommandTargetStatus) => void
}> = ({ data, tz, onEdit, onEditDef, onDeleteDef, onAdd }) => {
  const { t } = useLocale()

  if (!data) {
    return <NoticePanel status='danger'>{t('error')}</NoticePanel>
  }

  return (
    <FlexCol>
      {!data.enabled && <NoticePanel status='warning'>{t('command_disabled')}</NoticePanel>}

      <div className='text-foreground-500 text-xs'>
        {t('command_def_dir')}: <span className='font-mono break-all'>{data.dir}</span>
        {' / '}
        {t('command_def_loaded', { loaded: data.targets.length, excluded: data.issues.length })}
        {' / '}
        {dayformat(data.loadedAt, 'tz-minute', tz)}
      </div>

      {/* 読み込めなかったファイルがあっても、読み込めた分は使えるので一覧は常に出す */}
      {data.issues.length > 0 && (
        <NoticePanel status='danger' title={t('command_invalid_def')}>
          <FlexCol className='gap-1'>
            {data.issues.map((issue) => (
              <div key={issue.fileName ?? ''}>
                <span className='font-mono font-semibold break-all'>{issue.fileName ?? t('command_def_dir')}</span>
                <ul className='list-disc pl-5'>
                  {issue.messages.map((message) => (
                    <li key={message} className='break-all'>
                      {message}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </FlexCol>
        </NoticePanel>
      )}

      <CommandTargetTable targets={data.targets} writable={data.writable} onAdd={onAdd} />
      {data.commands.length === 0 ? (
        <NoticePanel>{t('command_no_def')}</NoticePanel>
      ) : (
        <CommandDefTable
          commands={data.commands}
          writable={data.writable}
          onEdit={onEdit}
          onEditDef={onEditDef}
          onDeleteDef={onDeleteDef}
        />
      )}
    </FlexCol>
  )
}
