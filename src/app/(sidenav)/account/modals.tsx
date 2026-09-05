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
import { SESSION_NOT_FRESH } from '@/lib/auth/auth-config'
import { useReAuth } from '@/lib/auth/use-re-auth'
import { ClientError, TOO_MANY_REQUESTS } from '@/lib/error'
import {
  DUPLICATED_MCP_TOKEN_NAME,
  MAX_MCP_TOKENS_PER_USER,
  MCP_SERVER_NAME,
  MCP_TOKEN_ENV,
  MCP_TOKEN_LIMIT_REACHED,
  mcpAddCommand,
  mcpCodexAddCommand,
  mcpTokenExportCommand,
} from '@/lib/mcp/mcp'
import { IssueMcpToken, scIssueMcpToken, scUpdatePasskey, UpdatePasskey } from '@/lib/schema/schema'
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
  const reAuth = useReAuth()
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
          if (!(e instanceof ClientError)) {
            throw e
          }
          switch (e.errorType) {
            case DUPLICATED_MCP_TOKEN_NAME:
              setError('name', { message: t('msg_duplicated_token_name') })
              return
            case MCP_TOKEN_LIMIT_REACHED:
              // 別のタブで上限に達した場合。閉じて一覧を読み直せば発行ボタンの無効化も追いつく
              notify.warn(t('msg_mcp_token_limit', { max: MAX_MCP_TOKENS_PER_USER }))
              close()
              return
            case TOO_MANY_REQUESTS:
              // 時間をおけば同じ入力で再試行できるのでモーダルは閉じない
              notify.warn(t('msg_too_many_requests'))
              return
            case SESSION_NOT_FRESH:
              await reAuth()
              return
            default:
              throw e
          }
        }
      })}
      title={{ text: t('issue_token'), icon: <KeyIcon /> }}
      size='lg' // 発行後に出す登録コマンドが長いので、既定の md より1段階広くする
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
      {/* 発行の前後でモーダルの高さが変わらないよう、内容の多い OUTPUT 側に高さを合わせる。
          スマホ幅では折り返しが増えて OUTPUT が高くなるので、その分だけ広く取る */}
      <div className='min-h-88 overflow-hidden sm:min-h-80'>
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
                    text={mcpAddCommand(baseUrl, issued, MCP_SERVER_NAME, 'user')}
                    label={t('mcp_add_command_claude')}
                    isMask
                    copyLabel={t('copy')}
                    showLabel={t('show')}
                    hideLabel={t('hide')}
                  />
                </div>
                <div className='col-span-12'>
                  <CopyableField // 環境変数の名前しか入らないので伏せ字にしない
                    text={mcpCodexAddCommand(baseUrl, MCP_SERVER_NAME, MCP_TOKEN_ENV)}
                    label={t('mcp_add_command_codex')}
                    copyLabel={t('copy')}
                  />
                </div>
                <div className='col-span-12'>
                  <CopyableField
                    text={mcpTokenExportCommand(MCP_TOKEN_ENV, issued)}
                    label={t('mcp_token_env_command')}
                    isMask
                    copyLabel={t('copy')}
                    showLabel={t('show')}
                    hideLabel={t('hide')}
                  />
                </div>
                <div className='col-span-12'>
                  <NoticePanel className='text-xs'>{t('msg_token_once')}</NoticePanel>
                </div>
                <div className='col-span-12'>
                  <NoticePanel className='text-xs'>{t('msg_mcp_token_env')}</NoticePanel>
                </div>
              </GridBox>
            </StepMotion>
          )}
        </AnimatePresence>
      </div>
    </FormModal>
  )
}
