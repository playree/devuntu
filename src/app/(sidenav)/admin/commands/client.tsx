'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CommandLineIcon } from '@/components/icon'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { CommandDefTable, CommandHostTable } from './command-tables'
import { type GetCommandDefsReturnType, getCommandDefsAction, reloadCommandDefsAction } from './server'

/**
 * コマンド管理(Phase 1 は読み取り専用)
 *
 * 定義そのものはサーバー上の YAML が持つ。この画面は「置いた定義が正しく読めているか」を
 * 確かめる場所で、有効化と許可グループの編集は Phase 2 で足す。
 */
export const AdminCommandsClient: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { data, isLoading, refresh } = useActionData(getCommandDefsAction)

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

      {isLoading && !data ? <PanelSkeleton /> : <CommandDefsBody data={data} tz={tz} />}
    </FlexCol>
  )
}

const CommandDefsBody: FC<{ data: GetCommandDefsReturnType; tz: string }> = ({ data, tz }) => {
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
            <CommandDefTable commands={data.commands} />
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
