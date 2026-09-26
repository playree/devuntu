'use client'

import { CommandLogView } from '@/components/command/command-log-view'
import { CommandStatusChip } from '@/components/command/command-status-chip'
import { useCommandStream } from '@/components/command/use-command-stream'
import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { NoticePanel, Panel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { CommandLineIcon, StopIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { COMMAND_TERMINAL_STATUSES } from '@/lib/command/command'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { useEffect, type FC } from 'react'
import { cancelCommandRun, getCommandRun, type GetCommandRunReturnType } from '../../server'

type RunDetail = NonNullable<GetCommandRunReturnType>

const isTerminal = (status: RunDetail['status']): boolean =>
  (COMMAND_TERMINAL_STATUSES as readonly string[]).includes(status)

/**
 * 実行の詳細。
 *
 * ログは SSE で受け取る。終了済みの実行を開いた場合も同じ経路で、
 * 全チャンクが流れたあと `end` が来てストリームが閉じる。
 * 「実行中を見る」と「履歴を見る」で分岐を持たないのが狙い。
 */
export const CommandRunClient: FC<{ runId: string }> = ({ runId }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { confirmModal } = useConfirmModal()

  const { data: run, isLoading, refresh } = useActionData(() => getCommandRun({ id: runId }))
  const { lines, ended, reconnecting } = useCommandStream(runId, true)

  // 終了を受け取ったら、状態(終了コード・失敗理由)を取り直す
  useEffect(() => {
    if (ended) {
      void refresh()
    }
  }, [ended, refresh])

  if (isLoading && !run) {
    return <PanelSkeleton />
  }
  if (!run) {
    // 権限が無い場合も「無い」と同じ扱いにしてある
    return <NoticePanel status='danger'>{t('not_found')}</NoticePanel>
  }

  const live = !isTerminal(run.status)

  return (
    <FlexCol
      /**
       * md 以上ではログ枠を画面下端まで伸ばし、ログ枠内のスクロールにする。
       * ログが短くても枠を下端まで広げたいので max-h- ではなく h- にしている
       */
      data-fit-screen
      className='md:h-full'
    >
      <ContentHeader icon={<CommandLineIcon />} title={run.commandLabel}>
        {live && (
          <MultiButton
            icon={<StopIcon />}
            variant='outline'
            onPress={async () => {
              const ok = await confirmModal().confirm({
                title: t('command_run_cancel'),
                text: t('msg_command_cancel_confirm'),
              })
              if (!ok) {
                return
              }
              // 確認している間に実行が終わっていると status は null。中断できていないので通知しない
              const { status } = await parseAction(cancelCommandRun({ id: runId }))
              if (status) {
                notify.info(t('msg_command_cancel_requested'))
              }
              await refresh()
            }}
          >
            {t('command_run_cancel')}
          </MultiButton>
        )}
      </ContentHeader>

      <Panel>
        <FlexCol>
          <FlexRow className='flex-wrap items-center'>
            <CommandStatusChip value={run.status} />
            <span className='text-muted text-xs'>{run.targetLabel}</span>
            {reconnecting && (
              <Chip color='warning' variant='soft' className='whitespace-nowrap'>
                {t('command_reconnecting')}
              </Chip>
            )}
            <span className='grow' />
            <span className='text-muted text-xs'>
              {t('command_executed_by')}: {run.userName}
            </span>
          </FlexRow>

          <div className='overflow-x-auto'>
            <pre className='font-mono text-xs whitespace-pre'>{run.argsPreview}</pre>
          </div>

          <FlexRow className='text-muted flex-wrap items-center text-xs'>
            <span>{dayformat(run.queuedAt, 'tz-minute', tz)}</span>
            {run.finishedAt && <span>→ {dayformat(run.finishedAt, 'tz-minute', tz)}</span>}
            {run.exitCode !== null && (
              <span>
                {t('command_exit_code')}: {run.exitCode}
              </span>
            )}
            {run.failureKind && <span className='font-mono'>{run.failureKind}</span>}
          </FlexRow>
        </FlexCol>
      </Panel>

      {run.truncated && <NoticePanel status='warning'>{t('command_truncated')}</NoticePanel>}

      <CommandLogView lines={lines} isLive={live} />
    </FlexCol>
  )
}
