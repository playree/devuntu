'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { FlexCol } from '@/components/general/flex'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps, useConfirmModal } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import { SingleSelectCtrl } from '@/components/general/select'
import { StepMotion } from '@/components/general/step-motion'
import { CheckIcon, KeyIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { IssueAgentToken, scIssueAgentToken } from '@/lib/schema'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence } from 'framer-motion'
import { FC, useCallback, useState } from 'react'
import { useForm } from 'react-hook-form'
import { AgentRow } from './client'
import { getAgentTokens, issueAgentToken, revokeAgentToken } from './server'

type Step = {
  id: 'INPUT' | 'OUTPUT'
  direction: number
}

/** MCP クライアントへ貼り付けるための登録コマンド。相対解決で baseUrl のパス末尾を落とさないよう / を補う */
const mcpAddCommand = (baseUrl: string, token: string) =>
  `claude mcp add --transport http devuntu ${new URL('api/mcp', `${baseUrl.replace(/\/+$/, '')}/`).toString()} --header "Authorization: Bearer ${token}"`

/**
 * エージェントのトークン管理。
 *
 * 平文は発行の応答でしか受け取れないので、発行後は OUTPUT ステップで一度だけ見せる。
 * 既存のトークンは末尾数文字(hint)でしか区別できない。
 */
export const TokenModal: FC<ModalBaseProps & { target: AgentRow; baseUrl: string }> = ({
  state,
  reload,
  target,
  baseUrl,
}) => {
  const { t, fet } = useLocale()
  const tz = useUserTimezone()
  const { confirmModal } = useConfirmModal()
  const [step, setStep] = useState<Step>({ id: 'INPUT', direction: 0 })
  const [issued, setIssued] = useState<string>()

  const load = useCallback(() => getAgentTokens({ id: target.id }), [target.id])
  const { data: tokens, reload: reloadTokens } = useActionData(load)

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<IssueAgentToken>({
    resolver: zodResolver(scIssueAgentToken),
    mode: 'onChange',
    defaultValues: {
      userId: target.id,
      name: '',
      expires: 'none',
    },
  })

  const revoke = async (id: string, name: string) => {
    try {
      const ok = await confirmModal().confirm({
        title: t('revoke_target', { target: name }),
        text: t('msg_confirm_revoke_token'),
        autoClose: false,
      })
      if (ok) {
        await parseAction(revokeAgentToken({ id }))
        notify.success(t('msg_revoked_target', { target: name }))
        reloadTokens()
        reload()
      }
    } finally {
      confirmModal().close()
    }
  }

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(issueAgentToken(req))
        setIssued(res.token)
        setStep({ id: 'OUTPUT', direction: 1 })
        reloadTokens()
        reload()
      })}
      title={{ text: `${t('agent_token')} - ${target.name}`, icon: <KeyIcon /> }}
      size='2xl'
      footer={
        <>
          {step.id === 'INPUT' && (
            <>
              <MultiButton slot='close' variant='ghost'>
                {t('cancel')}
              </MultiButton>
              <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
                {t('issue_token')}
              </MultiButton>
            </>
          )}
          {step.id === 'OUTPUT' && (
            <MultiButton icon={<CheckIcon />} onPress={() => state.close()}>
              {t('ok')}
            </MultiButton>
          )}
        </>
      }
    >
      <div className='min-h-72 overflow-hidden'>
        <AnimatePresence mode='wait' custom={step.direction}>
          {step.id === 'INPUT' && (
            <StepMotion direction={step.direction} key='step_input'>
              <FlexCol>
                <GridBox>
                  <div className='col-span-12 sm:col-span-7'>
                    <InputCtrl
                      control={control}
                      name='name'
                      constraintSchema={scIssueAgentToken}
                      label={t('token_name')}
                      errorMessage={fet(errors.name)}
                      autoFocus
                    />
                  </div>
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

                <ul className='divide-default-200 divide-y text-xs'>
                  {(tokens ?? []).map((token) => {
                    const isRevoked = !!token.revokedAt
                    return (
                      <li key={token.id} className='flex items-center gap-2 py-2'>
                        <span className='min-w-0 flex-1 truncate'>{token.name}</span>
                        <span className='font-mono opacity-70'>…{token.hint}</span>
                        <span className='font-mono opacity-70'>
                          {token.expiresAt ? dayformat(token.expiresAt, 'tz-simple', tz) : t('no_expiration')}
                        </span>
                        <span className='font-mono opacity-70'>
                          {token.lastUsedAt ? dayformat(token.lastUsedAt, 'tz-simple', tz) : '-'}
                        </span>
                        {isRevoked ? (
                          <Chip variant='soft'>{t('revoked')}</Chip>
                        ) : (
                          <MultiButton
                            isIconOnly
                            size='sm'
                            variant='danger-soft'
                            className='h-7 w-7 rounded-sm'
                            tooltip={t('revoke')}
                            onPress={() => revoke(token.id, token.name)}
                          >
                            <TrashIcon />
                          </MultiButton>
                        )}
                      </li>
                    )
                  })}
                </ul>
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
    </FormModal>
  )
}
