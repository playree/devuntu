'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CommandLineIcon } from '@/components/icon'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { CommandDefTable, CommandHostTable } from './command-tables'
import { SettingModal } from './modals'
import {
  type CommandDefView,
  type GetCommandDefsReturnType,
  getCommandDefsAction,
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
        <CommandDefsBody data={data} tz={tz} onEdit={(command) => settingModalState.open(command)} />
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
    </FlexCol>
  )
}

const CommandDefsBody: FC<{
  data: GetCommandDefsReturnType
  tz: string
  onEdit: (command: CommandDefView) => void
}> = ({ data, tz, onEdit }) => {
  const { t } = useLocale()

  if (!data) {
    return <NoticePanel status='danger'>{t('error')}</NoticePanel>
  }

  return (
    <FlexCol>
      {!data.enabled && <NoticePanel status='warning'>{t('command_disabled')}</NoticePanel>}

      <div className='text-foreground-500 text-xs'>
        {t('command_def_path')}: <span className='font-mono break-all'>{data.path}</span>
        {' / '}
        {dayformat(data.loadedAt, 'tz-minute', tz)}
      </div>

      {data.ok ? (
        <>
          <CommandHostTable hosts={data.hosts} />
          {data.commands.length === 0 ? (
            <NoticePanel>{t('command_no_def')}</NoticePanel>
          ) : (
            <CommandDefTable commands={data.commands} onEdit={onEdit} />
          )}
        </>
      ) : (
        <NoticePanel status='danger' title={t('command_invalid_def')}>
          {data.issues.join('\n')}
        </NoticePanel>
      )}
    </FlexCol>
  )
}
