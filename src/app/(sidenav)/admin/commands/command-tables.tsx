'use client'

import { FlexCol, FlexRow } from '@/components/general/flex'
import { Panel } from '@/components/general/panel'
import { type CommandInputType } from '@/lib/command/command'
import { type CommandHostStatus } from '@/lib/command/command-catalog'
import { type LocaleItem } from '@/locale'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { FC } from 'react'
import { type CommandDefView } from './server'

/** 入力種別 → ロケールキー。種別が増えたらここがコンパイルエラーになる */
const INPUT_TYPE_LABEL = {
  select: 'command_input_type_select',
  radio: 'command_input_type_radio',
  multiselect: 'command_input_type_multiselect',
  checkbox: 'command_input_type_checkbox',
} as const satisfies Record<CommandInputType, LocaleItem>

/** 準備できているかどうかだけを出す。鍵やホストのパスは画面に出さない */
const ReadyChip: FC<{ label: string; ready: boolean }> = ({ label, ready }) => {
  const { t } = useLocale()
  return (
    <Chip color={ready ? 'success' : 'danger'} variant='soft' className='whitespace-nowrap'>
      {label}: {ready ? t('ready') : t('not_ready')}
    </Chip>
  )
}

/**
 * ホストの状態。
 *
 * known_hosts が読めないホストは StrictHostKeyChecking=yes により接続できない(fail closed)ので、
 * 実行を試す前にここで気付けるようにする。
 */
export const CommandHostTable: FC<{ hosts: CommandHostStatus[] }> = ({ hosts }) => {
  const { t } = useLocale()

  if (hosts.length === 0) {
    return null
  }

  return (
    <FlexCol>
      <div className='text-sm font-semibold'>{t('command_host')}</div>
      {hosts.map((host) => (
        <Panel key={host.id}>
          <FlexRow className='flex-wrap items-center'>
            <span className='font-semibold'>{host.label}</span>
            <span className='text-foreground-500 font-mono text-xs'>{host.id}</span>
            <span className='grow' />
            <ReadyChip label={t('command_host_identity')} ready={host.identityReady} />
            <ReadyChip label={t('command_host_known_hosts')} ready={host.knownHostsReady} />
          </FlexRow>
        </Panel>
      ))}
    </FlexCol>
  )
}

/** コマンド定義の一覧。実行内容は argsPreview と同じ形で出し、接続先は表示名だけにする */
export const CommandDefTable: FC<{ commands: CommandDefView[] }> = ({ commands }) => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <div className='text-sm font-semibold'>{t('command_definition')}</div>
      {commands.map((command) => (
        <Panel key={command.id}>
          <FlexCol>
            <FlexRow className='flex-wrap items-center'>
              <span className='font-semibold'>{command.label}</span>
              <span className='text-foreground-500 font-mono text-xs'>{command.id}</span>
              <span className='grow' />
              {command.hostLabel && (
                <Chip variant='soft' className='whitespace-nowrap'>
                  {command.hostLabel}
                </Chip>
              )}
            </FlexRow>

            {command.description && <div className='text-foreground-500 text-xs'>{command.description}</div>}

            <div className='overflow-x-auto'>
              <pre className='font-mono text-xs whitespace-pre'>{[command.executable, ...command.args].join(' ')}</pre>
            </div>

            {command.inputs.length > 0 && (
              <FlexRow className='flex-wrap items-center'>
                <span className='text-foreground-500 text-xs'>{t('command_inputs')}</span>
                {command.inputs.map((input) => (
                  <Chip key={input.key} variant='soft' className='whitespace-nowrap'>
                    {input.label} / {t(INPUT_TYPE_LABEL[input.type])}
                    {input.optionCount > 0 && ` (${input.optionCount})`}
                  </Chip>
                ))}
              </FlexRow>
            )}

            <FlexRow className='text-foreground-500 flex-wrap items-center text-xs'>
              <span>
                {t('command_timeout')}: {command.timeoutSec}s
              </span>
              {command.singleton && <span>{t('command_singleton')}</span>}
              {command.requireConfirm && <span>{t('command_confirm_required')}</span>}
              {command.requireFreshSession && <span>{t('command_fresh_session_required')}</span>}
            </FlexRow>
          </FlexCol>
        </Panel>
      ))}
    </FlexCol>
  )
}
