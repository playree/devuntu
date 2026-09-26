'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { Grid } from '@/components/general/grid'
import { useModalState } from '@/components/general/modal'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ClockIcon, Cog6ToothIcon, CommandLineIcon, PlayIcon, ServerStackIcon } from '@/components/icon'
import { ReloadButton } from '@/components/reload-button'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Accordion, Card } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useMemo } from 'react'
import { CommandForm } from './command-form'
import { type AvailableCommandView, type AvailableTargetView, getAvailableCommands } from './server'

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
  const { data, isLoading, reload } = useActionData(getAvailableCommands)
  const formState = useModalState<AvailableCommandView>()
  /**
   * 既定は全ターゲット展開。
   * Accordion は data が揃ってから初めて描画されるため、マウント時には全キーが出そろっている。
   * 非制御なのでリロードで開閉状態は戻らない(その代わり後から増えたターゲットは閉じた状態で出る)。
   */
  const defaultExpandedKeys = useMemo(() => new Set(data?.targets.map((target) => target.key)), [data])

  return (
    <FlexCol>
      <ContentHeader icon={<CommandLineIcon />} title={t('command_exec')}>
        <MultiButton
          isIconOnly
          tooltip={t('command_run_history')}
          icon={<ClockIcon />}
          onPress={() => router.push('/commands/runs')}
        />
        <ReloadButton onReload={reload} />
      </ContentHeader>

      {isLoading && !data ? (
        <PanelSkeleton />
      ) : !data || data.targets.length === 0 ? (
        <NoticePanel>{t('command_no_target')}</NoticePanel>
      ) : (
        <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
          {data.targets.map((target) => (
            <TargetSection
              key={target.key}
              target={target}
              commands={data.commands.filter((command) => command.targetKey === target.key)}
              onSettings={() => router.push(`/commands/targets/${target.key}`)}
              onRun={(command) => formState.open(command)}
              onHistory={(command) => router.push(`/commands/runs?commandKey=${command.id}`)}
            />
          ))}
        </Accordion>
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
  onHistory: (command: AvailableCommandView) => void
}> = ({ target, commands, onSettings, onRun, onHistory }) => {
  const { t } = useLocale()

  return (
    <AccordionSection id={target.key} icon={<ServerStackIcon />} title={target.label}>
      <Grid>
        {target.role === 'owner' && (
          <FlexRow // 定義を編集できるのはオーナーだけなので、導線もオーナーにだけ出す。見出しはトリガーなのでボタンを置けない
            className='col-span-12 justify-end'
          >
            <MultiButton
              isIconOnly
              variant='outline'
              tooltip={t('command_target_settings')}
              icon={<Cog6ToothIcon />}
              onPress={onSettings}
            />
          </FlexRow>
        )}

        {commands.length === 0 ? (
          <NoticePanel className='col-span-12'>{t('command_no_def')}</NoticePanel>
        ) : (
          commands.map((command) => (
            <Card key={command.id} className='col-span-12 md:col-span-6'>
              <Card.Header>
                <Card.Title>{command.label}</Card.Title>
                <Card.Description>{command.description}</Card.Description>
              </Card.Header>
              <Card.Footer // 説明の行数がカードごとに違うので、ボタンは下端に寄せて揃える
                className='mt-auto justify-between'
              >
                <MultiButton icon={<PlayIcon />} variant='primary' size='sm' onPress={() => onRun(command)}>
                  {t('command_run')}
                </MultiButton>
                <MultiButton
                  isIconOnly
                  variant='outline'
                  size='sm'
                  tooltip={t('command_run_history')}
                  icon={<ClockIcon />}
                  onPress={() => onHistory(command)}
                />
              </Card.Footer>
            </Card>
          ))
        )}
      </Grid>
    </AccordionSection>
  )
}
