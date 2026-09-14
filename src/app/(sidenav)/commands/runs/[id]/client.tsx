'use client'

import { CommandLogView, type CommandLogLine } from '@/components/command/command-log-view'
import { CommandStatusChip } from '@/components/command/command-status-chip'
import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { NoticePanel, Panel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { CommandLineIcon, StopIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { COMMAND_TERMINAL_STATUSES } from '@/lib/command/command'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { useCallback, useEffect, useRef, useState, type FC } from 'react'
import { cancelCommandRunAction } from '../../server'
import { getCommandRunLogsAction, type GetCommandRunLogsReturnType } from './server'

/** 実行中の追いかけ間隔。Phase 4 で SSE に置き換える */
const POLL_MS = 1_000

type RunDetail = NonNullable<GetCommandRunLogsReturnType>['run']

const isTerminal = (status: RunDetail['status']): boolean =>
  (COMMAND_TERMINAL_STATUSES as readonly string[]).includes(status)

export const CommandRunClient: FC<{ runId: string }> = ({ runId }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { confirmModal } = useConfirmModal()

  const [run, setRun] = useState<RunDetail>()
  const [lines, setLines] = useState<CommandLogLine[]>([])
  const [notFound, setNotFound] = useState(false)
  /** 次に取りに行く位置。取得の重なりで巻き戻らないよう ref で持つ */
  const cursorRef = useRef(0)
  /** 取得が重なるのを防ぐ。開発時の二重マウントや遅い応答で同じ範囲を2回取りに行かせない */
  const inFlightRef = useRef(false)

  const poll = useCallback(async () => {
    if (inFlightRef.current) {
      return undefined
    }
    inFlightRef.current = true
    try {
      const res = await parseAction(getCommandRunLogsAction({ id: runId, afterSeq: cursorRef.current }))
      setRun(res.run)
      if (res.chunks.length > 0) {
        cursorRef.current = res.chunks[res.chunks.length - 1].seq
        setLines((prev) => {
          // カーソルの更新と state の反映は原子的でないので、seq で重複を弾く
          const seen = new Set(prev.map((line) => line.seq))
          const added = res.chunks
            .filter((chunk) => !seen.has(chunk.seq))
            .map(({ seq, stream, text }) => ({ seq, stream, text }))
          return added.length > 0 ? [...prev, ...added] : prev
        })
      }
      return res.run
    } catch {
      // 権限が無い / 掃除で消えた。どちらも「無い」として扱う
      setNotFound(true)
      return undefined
    } finally {
      inFlightRef.current = false
    }
  }, [runId])

  useEffect(() => {
    let stopped = false
    let timer: NodeJS.Timeout | undefined

    const loop = async () => {
      const current = await poll()
      if (stopped || notFound) {
        return
      }
      // 終端に達し、かつ未取得のチャンクが無ければ止める
      if (current && isTerminal(current.status) && cursorRef.current >= current.lastSeq) {
        return
      }
      timer = setTimeout(() => void loop(), POLL_MS)
    }

    void loop()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [poll, notFound])

  if (notFound) {
    return <NoticePanel status='danger'>{t('not_found')}</NoticePanel>
  }
  if (!run) {
    return <PanelSkeleton />
  }

  const live = !isTerminal(run.status)

  return (
    <FlexCol>
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
              await parseAction(cancelCommandRunAction({ id: runId }))
              notify.info(t('msg_command_cancel_requested'))
            }}
          >
            {t('command_run_cancel')}
          </MultiButton>
        )}
      </ContentHeader>

      <Panel>
        <FlexCol>
          <FlexRow className='flex-wrap items-center'>
            <CommandStatusChip status={run.status} />
            <span className='text-foreground-500 text-xs'>{run.hostLabel}</span>
            <span className='grow' />
            <span className='text-foreground-500 text-xs'>
              {t('command_executed_by')}: {run.userName}
            </span>
          </FlexRow>

          <div className='overflow-x-auto'>
            <pre className='font-mono text-xs whitespace-pre'>{run.argsPreview}</pre>
          </div>

          <FlexRow className='text-foreground-500 flex-wrap items-center text-xs'>
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
