'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectField } from '@/components/general/select'
import { SwitchCtrl } from '@/components/general/switch'
import { MultiTable } from '@/components/general/table'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { ActionResult, parseAction } from '@/lib/action/action-client'
import {
  AGENT_POLL_INTERVAL_OPTIONS,
  AGENT_UNLIMITED_DAILY_RUNS,
  AGENT_UNLIMITED_MONTHLY_BUDGET,
  AGENT_WINDOW_MAX_MIN,
  AGENT_WINDOW_STEP_MIN,
  DEFAULT_AGENT_DAILY_RESET_MIN,
  DEFAULT_POLL_INTERVAL_SEC,
} from '@/lib/agent/agent'
import type { AgentRunnerConfig } from '@/lib/agent/agent-runner-config'
import { useDefaultTimezone, useUserTimezone } from '@/lib/auth/use-timezone'
import { COMMON_TIMEZONES, dayformat, minToHHmm, tzOffsetLabel, tzOffsetMinutes } from '@/lib/day'
import { SaveAgentRunner, scSaveAgentRunner } from '@/lib/schema/schema-agent'
import { useLocale } from '@/locale/client'
import { Table } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useMemo } from 'react'
import { Control, Controller, FieldPath, useForm } from 'react-hook-form'

/** 設定を保存する Server Action。管理者用と承認者用で権限判定が違うため、呼び出し側から渡す */
type SaveRunnerAction = (input: SaveAgentRunner) => Promise<ActionResult<{ userId: string }>>

/** 稼働許可時間帯の選択肢(00:00〜23:30) */
const WINDOW_OPTIONS = Object.fromEntries(
  Array.from({ length: AGENT_WINDOW_MAX_MIN / AGENT_WINDOW_STEP_MIN + 1 }, (_, i) => i * AGENT_WINDOW_STEP_MIN).map(
    (min) => [String(min), minToHHmm(min)],
  ),
)

/** ポーリング間隔は分で見せる。ラベル側に単位を持たせているので数値だけを並べる */
const POLL_OPTIONS = Object.fromEntries(AGENT_POLL_INTERVAL_OPTIONS.map((sec) => [String(sec), String(sec / 60)]))

/** 時刻(0:00 からの分)の選択。稼働時間帯は未選択(null)を「指定なし」= 終日として許す */
const TimeSelect: FC<{
  control: Control<SaveAgentRunner>
  name: Extract<FieldPath<SaveAgentRunner>, 'activeFromMin' | 'activeToMin' | 'dailyResetMin'>
  label: string
  isClearable?: boolean
}> = ({ control, name, label, isClearable }) => (
  <Controller
    control={control}
    name={name}
    render={({ field: { value, onChange, onBlur, ref } }) => (
      <SingleSelectField
        isClearable={isClearable}
        groupOptions={WINDOW_OPTIONS}
        label={label}
        value={value === null || value === undefined ? null : String(value)}
        onChange={(key) => {
          if (key !== null || isClearable) {
            onChange(key === null ? null : Number(key))
          }
        }}
        onBlur={onBlur}
        ref={ref}
      />
    )}
  />
)

/** ランナーの稼働状況(ランナーからの報告値)を1行の表で出す */
const RunnerStatus: FC<{ current: AgentRunnerConfig }> = ({ current }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const cellClass = 'font-mono text-xs whitespace-nowrap'

  return (
    <MultiTable
      isSmart
      aria-label='agent runner status'
      items={[{ ...current, id: 'status' }]}
      columns={[
        { id: 'lastPolledAt', name: t('agent_last_polled'), isRowHeader: true, minWidth: 180, defaultWidth: '1fr' },
        { id: 'dailyUsage', name: t('agent_daily_usage'), minWidth: 120, defaultWidth: '1fr' },
        { id: 'host', name: t('agent_host'), minWidth: 120, defaultWidth: '1fr' },
        { id: 'version', name: t('version'), minWidth: 150, defaultWidth: '1fr' },
      ]}
    >
      {(row) => (
        <Table.Row id={row.id}>
          <Table.Cell className={cellClass}>{dayformat(row.lastPolledAt, 'tz-simple', tz) || '-'}</Table.Cell>
          <Table.Cell className={cellClass}>
            {`${row.todayRuns} / ${
              row.dailyRunLimit === AGENT_UNLIMITED_DAILY_RUNS ? t('agent_unlimited') : row.dailyRunLimit
            }`}
          </Table.Cell>
          <Table.Cell className={cellClass}>{row.hostname || '-'}</Table.Cell>
          <Table.Cell className={cellClass}>{row.version || '-'}</Table.Cell>
        </Table.Row>
      )}
    </MultiTable>
  )
}

const RunnerForm: FC<{
  agentId: string
  current: AgentRunnerConfig | null | undefined
  refresh: () => void
  save: SaveRunnerAction
}> = ({ agentId, current, refresh, save }) => {
  const { t, fet } = useLocale()
  const defaultTz = useDefaultTimezone()

  // 主要都市をオフセット順に並べる。設定済みの値が候補外なら先頭へ足して必ず選べるようにする
  const timezoneOptions = useMemo(() => {
    const value = current?.timezone ?? defaultTz
    const base = COMMON_TIMEZONES.includes(value) ? COMMON_TIMEZONES : [value, ...COMMON_TIMEZONES]
    return Object.fromEntries(
      [...base].sort((a, b) => tzOffsetMinutes(a) - tzOffsetMinutes(b)).map((zone) => [zone, tzOffsetLabel(zone)]),
    )
  }, [current?.timezone, defaultTz])

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<SaveAgentRunner>({
    resolver: zodResolver(scSaveAgentRunner),
    mode: 'onChange',
    defaultValues: {
      userId: agentId,
      enabled: current?.enabled ?? false,
      activeFromMin: current?.activeFromMin ?? null,
      activeToMin: current?.activeToMin ?? null,
      timezone: current?.timezone ?? defaultTz,
      pollIntervalSec: current?.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC,
      dailyRunLimit: current?.dailyRunLimit ?? AGENT_UNLIMITED_DAILY_RUNS,
      dailyResetMin: current?.dailyResetMin ?? DEFAULT_AGENT_DAILY_RESET_MIN,
      monthlyBudgetUsd: current?.monthlyBudgetUsd ?? AGENT_UNLIMITED_MONTHLY_BUDGET,
    },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(save(req))
        notify.success(t('msg_saved'))
        reset(req)
        refresh()
      })}
    >
      <GridBox isSmart>
        <div className='col-span-12'>
          <NoticePanel className='text-xs'>{t('msg_agent_runner_desc')}</NoticePanel>
        </div>

        <div className='col-span-6 flex items-center md:col-span-2'>
          <SwitchCtrl control={control} name='enabled' id='agent-runner-enabled' label={t('enabled')} />
        </div>
        <div className='col-span-6 md:col-span-2'>
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
        <div className='col-span-6 md:col-span-8'>
          <Controller
            control={control}
            name='timezone'
            render={({ field: { value, onChange, onBlur, ref } }) => (
              <SingleSelectField
                groupOptions={timezoneOptions}
                label={t('timezone')}
                errorMessage={fet(errors.timezone)}
                value={value ?? defaultTz}
                onChange={onChange}
                onBlur={onBlur}
                ref={ref}
              />
            )}
          />
        </div>

        <div className='col-span-6 md:col-span-3'>
          <TimeSelect isClearable control={control} name='activeFromMin' label={t('start_time')} />
        </div>
        <div className='col-span-6 md:col-span-3'>
          <TimeSelect isClearable control={control} name='activeToMin' label={t('end_time')} />
        </div>

        <div className='col-span-6 md:col-span-3'>
          <InputCtrl
            control={control}
            name='dailyRunLimit'
            constraintSchema={scSaveAgentRunner}
            isRequired={false} // 既定値(無制限)が必ず入るため、必須の印は出さない
            type='number'
            label={t('agent_daily_limit')}
            errorMessage={fet(errors.dailyRunLimit)}
          />
        </div>
        <div className='col-span-6 md:col-span-3'>
          <TimeSelect control={control} name='dailyResetMin' label={t('agent_daily_reset')} />
        </div>
        <div className='col-span-6 md:col-span-3'>
          <InputCtrl
            control={control}
            name='monthlyBudgetUsd'
            constraintSchema={scSaveAgentRunner}
            isRequired={false} // 既定値(無制限)が必ず入るため、必須の印は出さない
            type='number'
            step='0.01'
            label={t('agent_monthly_budget')}
            errorMessage={fet(errors.monthlyBudgetUsd)}
          />
        </div>

        {current && (
          <div className='col-span-12'>
            <RunnerStatus current={current} />
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
  current: AgentRunnerConfig | null | undefined
  isLoading: boolean
  refresh: () => void
  save: SaveRunnerAction
}> = ({ agentId, current, isLoading, refresh, save }) => {
  if (isLoading) {
    return <PanelSkeleton />
  }
  return <RunnerForm agentId={agentId} current={current} refresh={refresh} save={save} />
}
