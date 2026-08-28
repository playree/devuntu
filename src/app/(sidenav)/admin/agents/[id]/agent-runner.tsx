'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectField } from '@/components/general/select'
import { SwitchCtrl } from '@/components/general/switch'
import { CheckIcon } from '@/components/icon'
import { MarkdownEditor } from '@/components/markdown/markdown-editor'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import {
  AGENT_POLL_INTERVAL_OPTIONS,
  AGENT_TASK_MODE_LOCALE,
  AGENT_TASK_MODES,
  AGENT_WINDOW_MAX_MIN,
  AGENT_WINDOW_STEP_MIN,
  DEFAULT_POLL_INTERVAL_SEC,
} from '@/lib/agent/agent'
import { COMMON_TIMEZONES, dayformat, DEFAULT_TZ, minToHHmm, tzOffsetLabel, tzOffsetMinutes } from '@/lib/day'
import { SaveAgentRunner, scSaveAgentRunner } from '@/lib/schema/schema'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, ReactNode, useMemo } from 'react'
import { Control, Controller, FieldPath, useForm } from 'react-hook-form'
import { GetAgentRunnerReturnType, saveAgentRunner } from './server'

/** 稼働許可時間帯の選択肢(00:00〜23:30) */
const WINDOW_OPTIONS = Object.fromEntries(
  Array.from({ length: AGENT_WINDOW_MAX_MIN / AGENT_WINDOW_STEP_MIN + 1 }, (_, i) => i * AGENT_WINDOW_STEP_MIN).map(
    (min) => [String(min), minToHHmm(min)],
  ),
)

/** ポーリング間隔は分で見せる。ラベル側に単位を持たせているので数値だけを並べる */
const POLL_OPTIONS = Object.fromEntries(AGENT_POLL_INTERVAL_OPTIONS.map((sec) => [String(sec), String(sec / 60)]))

/** 時刻(0:00 からの分)の選択。未選択(null)は「指定なし」= 終日 */
const WindowSelect: FC<{
  control: Control<SaveAgentRunner>
  name: Extract<FieldPath<SaveAgentRunner>, 'activeFromMin' | 'activeToMin'>
  label: string
}> = ({ control, name, label }) => (
  <Controller
    control={control}
    name={name}
    render={({ field: { value, onChange, onBlur, ref } }) => (
      <SingleSelectField
        isClearable
        groupOptions={WINDOW_OPTIONS}
        label={label}
        value={value === null ? null : String(value)}
        onChange={(key) => onChange(key === null ? null : Number(key))}
        onBlur={onBlur}
        ref={ref}
      />
    )}
  />
)

const StatusField: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className='flex items-center justify-between gap-2'>
    <span className='opacity-70'>{label}</span>
    <span className='truncate font-mono'>{children}</span>
  </div>
)

const RunnerForm: FC<{ agentId: string; current: GetAgentRunnerReturnType; reload: () => void }> = ({
  agentId,
  current,
  reload,
}) => {
  const { t, fet } = useLocale()
  const tz = useUserTimezone()

  // 主要都市をオフセット順に並べる。設定済みの値が候補外なら先頭へ足して必ず選べるようにする
  const timezoneOptions = useMemo(() => {
    const value = current?.timezone ?? DEFAULT_TZ
    const base = COMMON_TIMEZONES.includes(value) ? COMMON_TIMEZONES : [value, ...COMMON_TIMEZONES]
    return Object.fromEntries(
      [...base].sort((a, b) => tzOffsetMinutes(a) - tzOffsetMinutes(b)).map((zone) => [zone, tzOffsetLabel(zone)]),
    )
  }, [current?.timezone])

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<SaveAgentRunner>({
    resolver: zodResolver(scSaveAgentRunner),
    mode: 'onChange',
    defaultValues: {
      userId: agentId,
      enabled: current?.enabled ?? false,
      activeFromMin: current?.activeFromMin ?? null,
      activeToMin: current?.activeToMin ?? null,
      timezone: current?.timezone ?? DEFAULT_TZ,
      pollIntervalSec: current?.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC,
      defaultMode: current?.defaultMode ?? 'plan',
      rule: current?.rule ?? '',
    },
  })

  const modeOptions = Object.fromEntries(AGENT_TASK_MODES.map((mode) => [mode, t(AGENT_TASK_MODE_LOCALE[mode])]))

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(saveAgentRunner(req))
        notify.success(t('msg_saved'))
        reload()
      })}
    >
      <GridBox isSmart>
        <div className='col-span-12'>
          <NoticePanel className='text-xs'>{t('msg_agent_runner_desc')}</NoticePanel>
        </div>

        <div className='col-span-12'>
          <SwitchCtrl control={control} name='enabled' id='agent-runner-enabled' label={t('enabled')} />
        </div>

        <div className='col-span-6 md:col-span-3'>
          <WindowSelect control={control} name='activeFromMin' label={t('start_time')} />
        </div>
        <div className='col-span-6 md:col-span-3'>
          <WindowSelect control={control} name='activeToMin' label={t('end_time')} />
        </div>
        <div className='col-span-12 md:col-span-6'>
          <Controller
            control={control}
            name='timezone'
            render={({ field: { value, onChange, onBlur, ref } }) => (
              <SingleSelectField
                groupOptions={timezoneOptions}
                label={t('timezone')}
                errorMessage={fet(errors.timezone)}
                value={value ?? DEFAULT_TZ}
                onChange={onChange}
                onBlur={onBlur}
                ref={ref}
              />
            )}
          />
        </div>
        <div className='col-span-12'>
          <NoticePanel className='text-xs'>{t('msg_agent_window_desc')}</NoticePanel>
        </div>

        <div className='col-span-6'>
          <Controller
            control={control}
            name='pollIntervalSec'
            render={({ field: { value, onChange, onBlur, ref } }) => (
              <SingleSelectField
                groupOptions={POLL_OPTIONS}
                label={t('agent_poll_interval')}
                errorMessage={fet(errors.pollIntervalSec)}
                value={String(value)}
                onChange={(key) => {
                  if (key !== null) {
                    onChange(Number(key))
                  }
                }}
                onBlur={onBlur}
                ref={ref}
              />
            )}
          />
        </div>
        <div className='col-span-6'>
          <Controller
            control={control}
            name='defaultMode'
            render={({ field: { value, onChange, onBlur, ref } }) => (
              <SingleSelectField
                groupOptions={modeOptions}
                label={t('agent_default_mode')}
                value={value}
                onChange={(key) => {
                  if (key !== null) {
                    onChange(key)
                  }
                }}
                onBlur={onBlur}
                ref={ref}
              />
            )}
          />
        </div>

        <div className='col-span-12'>
          <MarkdownEditor
            control={control}
            name='rule'
            constraintSchema={scSaveAgentRunner}
            label={t('agent_rule')}
            errorMessage={fet(errors.rule)}
            minRows={4}
          />
        </div>

        {current && (
          <div className='col-span-12 space-y-1 border-t pt-2 text-xs'>
            <StatusField label={t('agent_last_polled')}>
              {current.lastPolledAt ? dayformat(current.lastPolledAt, 'tz-simple', tz) : '-'}
            </StatusField>
            <StatusField label={t('agent_host')}>{current.hostname || '-'}</StatusField>
            <StatusField label={t('version')}>{current.version || '-'}</StatusField>
          </div>
        )}

        <div className='col-span-12 flex items-center gap-2'>
          <MultiButton className='ml-auto' type='submit' size='sm' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </GridBox>
    </form>
  )
}

/**
 * 自動運用の設定。
 *
 * 設定行が無い状態(= 自動運用を使わない)から始まるので、読み込みが済むまでフォームを組まない。
 * 既定値を後から `reset` で流し込むと、開いた直後の一瞬だけ空の設定が見えてしまうため。
 */
export const AgentRunner: FC<{
  agentId: string
  current: GetAgentRunnerReturnType
  isLoading: boolean
  reload: () => void
}> = ({ agentId, current, isLoading, reload }) => {
  if (isLoading) {
    return <PanelSkeleton />
  }
  return <RunnerForm agentId={agentId} current={current} reload={reload} />
}
