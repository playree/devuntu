'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { NoticePanel, Panel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CommandLineIcon } from '@/components/icon'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { FC } from 'react'
import { getAvailableCommandsAction } from './server'

/**
 * 実行できるコマンドの一覧。
 *
 * Phase 2 の時点では一覧までで、実行フォームと実行ボタンは Phase 3 で足す。
 */
export const CommandsClient: FC = () => {
  const { t } = useLocale()
  const { data, isLoading, reload } = useActionData(getAvailableCommandsAction)

  return (
    <FlexCol>
      <ContentHeader icon={<CommandLineIcon />} title={t('command_exec')}>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => reload()}>
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
                </FlexRow>
                {command.description && <div className='text-foreground-500 text-xs'>{command.description}</div>}
              </FlexCol>
            </Panel>
          ))}
        </FlexCol>
      )}
    </FlexCol>
  )
}
