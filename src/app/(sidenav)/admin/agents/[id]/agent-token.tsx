'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { FlexCol } from '@/components/general/flex'
import { GridBox } from '@/components/general/grid'
import { useConfirmModal } from '@/components/general/modal'
import { NoticePanel, Panel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectCtrl } from '@/components/general/select'
import { StepMotion } from '@/components/general/step-motion'
import { ArrowPathIcon, CheckIcon } from '@/components/icon'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { IssueAgentToken, scIssueAgentToken } from '@/lib/schema'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence } from 'framer-motion'
import { FC, ReactNode, useState } from 'react'
import { useForm } from 'react-hook-form'
import { GetAgentTokenReturnType, issueAgentToken } from './server'

type Step = {
  id: 'INPUT' | 'OUTPUT'
  direction: number
}

/** MCP クライアントへ貼り付けるための登録コマンド。相対解決で baseUrl のパス末尾を落とさないよう / を補う */
const mcpAddCommand = (baseUrl: string, token: string) =>
  `claude mcp add --transport http devuntu ${new URL('api/mcp', `${baseUrl.replace(/\/+$/, '')}/`).toString()} --header "Authorization: Bearer ${token}"`

const TokenField: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className='flex items-center justify-between gap-2'>
    <span className='opacity-70'>{label}</span>
    <span className='truncate font-mono'>{children}</span>
  </div>
)

/**
 * エージェントのトークン管理。
 *
 * エージェントは1本しかトークンを持てないので、発行は既存トークンの置き換え(ローテート)になる。
 * 平文は発行の応答でしか受け取れないため、発行後は OUTPUT ステップで一度だけ見せる。
 */
export const AgentToken: FC<{
  agentId: string
  baseUrl: string
  current: GetAgentTokenReturnType
  isLoading: boolean
  reload: () => void
}> = ({ agentId, baseUrl, current, isLoading, reload }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { confirmModal } = useConfirmModal()
  const [step, setStep] = useState<Step>({ id: 'INPUT', direction: 0 })
  const [issued, setIssued] = useState<string>()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<IssueAgentToken>({
    resolver: zodResolver(scIssueAgentToken),
    mode: 'onChange',
    defaultValues: {
      userId: agentId,
      expires: 'none',
    },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        // 置き換えになる場合だけ確認する。今のトークンを使っている接続はその場で切れる
        if (current) {
          try {
            const ok = await confirmModal().confirm({
              title: t('reissue_token'),
              text: t('msg_confirm_rotate_token'),
            })
            if (!ok) {
              return
            }
          } finally {
            confirmModal().close()
          }
        }
        const res = await parseAction(issueAgentToken(req))
        setIssued(res.token)
        setStep({ id: 'OUTPUT', direction: 1 })
        reload()
      })}
    >
      <div className='min-h-72 overflow-hidden'>
        <AnimatePresence mode='wait' custom={step.direction}>
          {step.id === 'INPUT' && (
            <StepMotion direction={step.direction} key='step_input'>
              <FlexCol>
                <GridBox>
                  <div className='col-span-12 sm:col-span-5'>
                    <SingleSelectCtrl
                      control={control}
                      name='expires'
                      label={t('token_expiration')}
                      groupOptions={{
                        none: t('no_expiration'),
                        '30': t('expires_in_days', { days: 30 }),
                        '90': t('expires_in_days', { days: 90 }),
                        '180': t('expires_in_days', { days: 180 }),
                        '365': t('expires_in_days', { days: 365 }),
                      }}
                    />
                  </div>
                </GridBox>

                <FlexCol className='gap-1'>
                  <span className='text-xs opacity-70'>{t('current_token')}</span>
                  {isLoading ? (
                    <PanelSkeleton className='min-h-24' />
                  ) : current ? (
                    <Panel className='flex flex-col gap-1 py-3 text-xs'>
                      <TokenField label={t('agent_token')}>…{current.hint}</TokenField>
                      <TokenField label={t('issued_at')}>{dayformat(current.createdAt, 'tz-simple', tz)}</TokenField>
                      <TokenField label={t('token_expiration')}>
                        {current.expiresAt ? dayformat(current.expiresAt, 'tz-simple', tz) : t('no_expiration')}
                      </TokenField>
                      <TokenField label={t('last_used')}>
                        {current.lastUsedAt ? dayformat(current.lastUsedAt, 'tz-simple', tz) : '-'}
                      </TokenField>
                    </Panel>
                  ) : (
                    <NoticePanel className='text-xs'>{t('not_issued')}</NoticePanel>
                  )}
                </FlexCol>

                <div className='flex items-center gap-2'>
                  <MultiButton
                    className='ml-auto'
                    type='submit'
                    size='sm'
                    icon={current ? <ArrowPathIcon /> : <CheckIcon />}
                    isPending={isSubmitting}
                    isDisabled={isLoading}
                  >
                    {current ? t('reissue_token') : t('issue_token')}
                  </MultiButton>
                </div>
              </FlexCol>
            </StepMotion>
          )}

          {step.id === 'OUTPUT' && issued && (
            <StepMotion direction={step.direction} key='step_output'>
              <GridBox>
                <div className='col-span-12'>
                  <CopyableField
                    text={issued}
                    label={t('agent_token')}
                    isMask
                    copyLabel={t('copy')}
                    showLabel={t('show')}
                    hideLabel={t('hide')}
                  />
                </div>
                <div className='col-span-12'>
                  <CopyableField
                    text={mcpAddCommand(baseUrl, issued)}
                    label={t('mcp_add_command')}
                    isMask
                    copyLabel={t('copy')}
                    showLabel={t('show')}
                    hideLabel={t('hide')}
                  />
                </div>
                <div className='col-span-12'>
                  <NoticePanel className='text-xs'>{t('msg_agent_token_once')}</NoticePanel>
                </div>
              </GridBox>
            </StepMotion>
          )}
        </AnimatePresence>
      </div>
    </form>
  )
}
