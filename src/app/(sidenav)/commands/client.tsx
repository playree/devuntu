'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { NoticePanel, Panel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, ClockIcon, CommandLineIcon, PlayIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Chip } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { CommandForm } from './command-form'
import { type AvailableCommandView, getAvailableCommandsAction } from './server'

/**
 * 実行できるコマンドの一覧。
 *
 * 出るのは「今このユーザーが実行できるもの」だけ(`listAvailableCommands(user, 'execute')`)。
 * 一覧に出るのに押すと弾かれる、という状態を作らないため。
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
      ) : !data || data.length === 0 ? (
        <NoticePanel>{t('command_no_available')}</NoticePanel>
      ) : (
        <FlexCol>
          {data.map((command) => (
            <Panel key={command.id}>
              <FlexCol>
                <FlexRow className='flex-wrap items-center'>
                  <span className='font-semibold'>{command.label}</span>
                  <span className='grow' />
                  {command.hostLabel && (
                    <Chip variant='soft' className='whitespace-nowrap'>
                      {command.hostLabel}
                    </Chip>
                  )}
                  <MultiButton icon={<PlayIcon />} variant='outline' onPress={() => formState.open(command)}>
                    {t('command_run')}
                  </MultiButton>
                </FlexRow>
                {command.description && <div className='text-foreground-500 text-xs'>{command.description}</div>}
              </FlexCol>
            </Panel>
          ))}
        </FlexCol>
      )}

      {formState.target && (
        <CommandForm state={formState} reload={reload} key={formState.key} target={formState.target} />
      )}
    </FlexCol>
  )
}
