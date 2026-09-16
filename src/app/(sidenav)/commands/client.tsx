'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { NoticePanel, Panel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, ClockIcon, Cog6ToothIcon, CommandLineIcon, PlayIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { ButtonGroup } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { CommandForm } from './command-form'
import { type AvailableCommandView, type AvailableTargetView, getAvailableCommandsAction } from './server'

/**
 * 実行できるコマンドの一覧。
 *
 * 出るのは「自分がアサインされているターゲットのコマンド」だけ。
 * ターゲットごとにまとめるのは、実行の許可がターゲット単位で決まるため。
 * オーナーには定義を編集するための導線(歯車)を出す。
 */
export const CommandsClient: FC = () => {
  const { t } = useLocale()
  const router = useRouter()
  const { data, isLoading, reload } = useActionData(getAvailableCommandsAction)
  const formState = useModalState<AvailableCommandView>()

  return (
    <FlexCol>
      <ContentHeader icon={<CommandLineIcon />} title={t('command_exec')}>
        <MultiButton isIconOnly tooltip={t('command_run_history')} onPress={() => router.push('/commands/runs')}>
          <ClockIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => reload()}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      {isLoading && !data ? (
        <PanelSkeleton />
      ) : !data || data.targets.length === 0 ? (
        <NoticePanel>{t('command_no_target')}</NoticePanel>
      ) : (
        <FlexCol className='gap-6'>
          {data.targets.map((target) => (
            <TargetSection
              key={target.key}
              target={target}
              commands={data.commands.filter((command) => command.targetKey === target.key)}
              onSettings={() => router.push(`/commands/targets/${target.key}`)}
              onRun={(command) => formState.open(command)}
            />
          ))}
        </FlexCol>
      )}

      {formState.target && (
        <CommandForm state={formState} reload={reload} key={formState.key} target={formState.target} />
      )}
    </FlexCol>
  )
}

const TargetSection: FC<{
  target: AvailableTargetView
  commands: AvailableCommandView[]
  onSettings: () => void
  onRun: (command: AvailableCommandView) => void
}> = ({ target, commands, onSettings, onRun }) => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <FlexRow className='flex-wrap items-center'>
        <span className='text-sm font-semibold'>{target.label}</span>
        <span className='grow' />
        {/* 定義を編集できるのはオーナーだけなので、導線もオーナーにだけ出す */}
        {target.role === 'owner' && (
          <MultiButton isIconOnly variant='outline' tooltip={t('command_target_settings')} onPress={onSettings}>
            <Cog6ToothIcon />
          </MultiButton>
        )}
      </FlexRow>

      {commands.length === 0 ? (
        <NoticePanel>{t('command_no_def')}</NoticePanel>
      ) : (
        commands.map((command) => (
          <Panel key={command.id}>
            <FlexCol>
              <FlexRow className='flex-wrap items-center'>
                <span className='font-semibold'>{command.label}</span>
                <span className='grow' />
                <MultiButton icon={<PlayIcon />} variant='outline' onPress={() => onRun(command)}>
                  {t('command_run')}
                </MultiButton>
              </FlexRow>
              {command.description && <div className='text-foreground-500 text-xs'>{command.description}</div>}
            </FlexCol>
          </Panel>
        ))
      )}
    </FlexCol>
  )
}
