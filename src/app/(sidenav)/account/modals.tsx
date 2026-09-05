'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import { StepMotion } from '@/components/general/step-motion'
import { CheckIcon, KeyIcon, PencilSquareIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { TokenExpiresSelect } from '@/components/token-expires-select'
import { parseAction } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { ClientError } from '@/lib/error'
import { mcpAddCommand } from '@/lib/mcp/mcp-add-command'
import { IssueMcpToken, scIssueMcpToken, scUpdatePasskey, UpdatePasskey } from '@/lib/schema/schema'
import { DUPLICATED_MCP_TOKEN_NAME } from '@/lib/token-expires'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence } from 'framer-motion'
import { FC, useState } from 'react'
import { useForm } from 'react-hook-form'
import { issueMcpToken } from './server'

export const UpdatePasskeyModal: FC<ModalBaseProps & { target: UpdatePasskey }> = ({ state, reload, target }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpdatePasskey>({
    resolver: zodResolver(scUpdatePasskey),
    mode: 'onChange',
    defaultValues: {
      id: target.id,
      name: target.name,
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const { data } = await authClient.passkey.updatePasskey({
          id: req.id,
          name: req.name,
        })
        if (data?.passkey) {
          notify.success(t('msg_updated_target', { target: req.name }))
          reload()
          state.close()
        }
      })}
      title={{ text: t('update_passkey'), icon: <PencilSquareIcon /> }}
      footer={
        <>
          <MultiButton slot='close' variant='ghost'>
            {t('cancel')}
          </MultiButton>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('ok')}
          </MultiButton>
        </>
      }
    >
      <GridBox>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='name'
            constraintSchema={scUpdatePasskey}
            label={t('name')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
      </GridBox>
    </FormModal>
  )
}

type Step = {
  id: 'INPUT' | 'OUTPUT'
  direction: number
}

/**
 * ユーザー用 MCP トークンの発行。
 *
 * 平文は発行の応答でしか受け取れないので、OUTPUT ステップで一度だけ見せる。
 * 控え損ねを防ぐため、OUTPUT ではキャンセルを出さず閉じる操作だけを残す。
 */
export const IssueMcpTokenModal: FC<ModalBaseProps & { baseUrl: string }> = ({ state, reload, baseUrl }) => {
  const { t, fet } = useLocale()
  const [step, setStep] = useState<Step>({ id: 'INPUT', direction: 0 })
  const [issued, setIssued] = useState<string>()

  const {
    control,
    handleSubmit,
    setError,
    formState: { isSubmitting, errors },
  } = useForm<IssueMcpToken>({
    resolver: zodResolver(scIssueMcpToken),
    mode: 'onChange',
    defaultValues: {
      name: '',
      // 人が使うトークンは期限付きを既定にする
      expires: '90',
    },
  })

  const close = () => {
    reload()
    state.close()
  }

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        try {
          const res = await parseAction(issueMcpToken(req))
          setIssued(res.token)
          setStep({ id: 'OUTPUT', direction: 1 })
        } catch (e) {
          if (e instanceof ClientError && e.errorType === DUPLICATED_MCP_TOKEN_NAME) {
            setError('name', { message: t('msg_duplicated_token_name') })
            return
          }
          throw e
        }
      })}
      title={{ text: t('issue_token'), icon: <KeyIcon /> }}
      hiddenCloseButton={step.id === 'OUTPUT'}
      footer={
        step.id === 'OUTPUT' ? (
          <MultiButton icon={<CheckIcon />} onPress={close}>
            {t('ok')}
          </MultiButton>
        ) : (
          <>
            <MultiButton slot='close' variant='ghost'>
              {t('cancel')}
            </MultiButton>
            <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
              {t('issue_token')}
            </MultiButton>
          </>
        )
      }
    >
      <div className='min-h-52 overflow-hidden'>
        <AnimatePresence mode='wait' custom={step.direction}>
          {step.id === 'INPUT' && (
            <StepMotion direction={step.direction} key='step_input'>
              <GridBox>
                <div className='col-span-12'>
                  <InputCtrl
                    control={control}
                    name='name'
                    constraintSchema={scIssueMcpToken}
                    label={t('name')}
                    errorMessage={fet(errors.name)}
                    autoFocus
                  />
                </div>
                <div className='col-span-12 sm:col-span-6'>
                  <TokenExpiresSelect control={control} name='expires' />
                </div>
              </GridBox>
            </StepMotion>
          )}

          {step.id === 'OUTPUT' && issued && (
            <StepMotion direction={step.direction} key='step_output'>
              <GridBox>
                <div className='col-span-12'>
                  <CopyableField
                    text={issued}
                    label={t('mcp_token')}
                    isMask
                    copyLabel={t('copy')}
                    showLabel={t('show')}
                    hideLabel={t('hide')}
                  />
                </div>
                <div className='col-span-12'>
                  <CopyableField
                    text={mcpAddCommand(baseUrl, issued, 'devuntu-token')}
                    label={t('mcp_add_command')}
                    isMask
                    copyLabel={t('copy')}
                    showLabel={t('show')}
                    hideLabel={t('hide')}
                  />
                </div>
                <div className='col-span-12'>
                  <NoticePanel className='text-xs'>{t('msg_token_once')}</NoticePanel>
                </div>
              </GridBox>
            </StepMotion>
          )}
        </AnimatePresence>
      </div>
    </FormModal>
  )
}
