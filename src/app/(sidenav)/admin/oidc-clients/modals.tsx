'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxCtrl, CheckBoxField } from '@/components/general/checkbox'
import { CopyableField } from '@/components/general/copyable-field'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { SingleSelectCtrl, SingleSelectField } from '@/components/general/select'
import { StepMotion } from '@/components/general/step-motion'
import { CheckIcon, PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { AddOidcClient, scAddOidcClient, scUpdateOidcClient, UpdateOidcClient } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { Typography } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence } from 'framer-motion'
import { FC, useState } from 'react'
import { useForm } from 'react-hook-form'
import { addOidcClient, updateOidcClient } from './server'

type Step = {
  id: 'INPUT' | 'OUTPUT'
  direction: number
}

export const AddModal: FC<ModalBaseProps & { baseUrl: string }> = ({ state, reload, baseUrl }) => {
  const { t, fet } = useLocale()
  const [step, setStep] = useState<Step>({ id: 'INPUT', direction: 0 })
  const [output, setOutput] = useState<{ clientId: string; clientSecret: string }>()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<AddOidcClient>({
    resolver: zodResolver(scAddOidcClient),
    mode: 'onChange',
    defaultValues: {
      clientName: '',
      redirectUri: '',
      skipConsent: false,
      requirePkce: false,
      tokenEndpointAuthMethod: 'client_secret_basic',
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(addOidcClient(req))
        setOutput(res)
        setStep({ id: 'OUTPUT', direction: 1 })
        // notify.success(t('msg_added_target', { target: req.clientName }))
        reload()
      })}
      title={{ text: t('add_client'), icon: <PlusIcon /> }}
      footer={
        <>
          {step.id === 'INPUT' && (
            <>
              <MultiButton slot='close' variant='ghost'>
                {t('cancel')}
              </MultiButton>
              <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
                {t('ok')}
              </MultiButton>
            </>
          )}
          {step.id === 'OUTPUT' && (
            <MultiButton icon={<CheckIcon />} isPending={isSubmitting} onPress={() => state.close()}>
              {t('ok')}
            </MultiButton>
          )}
        </>
      }
    >
      <div className='min-h-64 overflow-hidden'>
        <AnimatePresence mode='wait' custom={step.direction}>
          {step.id === 'INPUT' && (
            <StepMotion direction={step.direction} key='step_input'>
              <GridBox>
                <div className='col-span-12'>
                  <InputCtrl
                    control={control}
                    name='clientName'
                    label={t('client_name')}
                    errorMessage={fet(errors.clientName)}
                    isRequired
                    autoFocus
                  />
                </div>
                <div className='col-span-12'>
                  <InputCtrl
                    control={control}
                    name='redirectUri'
                    label={t('redirect_uri')}
                    errorMessage={fet(errors.redirectUri)}
                    isRequired
                  />
                </div>
                <div className='col-span-12'>
                  <CheckBoxCtrl control={control} name='skipConsent' id='skipConsent' label={t('skip_consent')} />
                </div>
                <div className='col-span-12'>
                  <CheckBoxCtrl control={control} name='requirePkce' id='requirePkce' label={t('require_pkce')} />
                </div>
                <div className='col-span-12'>
                  <SingleSelectCtrl
                    control={control}
                    name='tokenEndpointAuthMethod'
                    label={t('token_endpoint_auth_method')}
                    isRequired
                    errorMessage={fet(errors.tokenEndpointAuthMethod)}
                    groupOptions={{
                      client_secret_basic: t('token_endpoint_auth_method_basic'),
                      client_secret_post: t('token_endpoint_auth_method_post'),
                    }}
                  />
                </div>
              </GridBox>
            </StepMotion>
          )}

          {step.id === 'OUTPUT' && output && (
            <StepMotion direction={step.direction} key='step_output'>
              <GridBox>
                <div className='col-span-12'>
                  <CopyableField text={output.clientId} label={t('client_id')} copyLabel={t('copy')} />
                </div>
                <div className='col-span-12'>
                  <CopyableField
                    text={output.clientSecret}
                    label={t('client_secret')}
                    isMask
                    copyLabel={t('copy')}
                    showLabel={t('show')}
                    hideLabel={t('hide')}
                  />
                </div>
                <div className='col-span-12'>
                  <CopyableField
                    text={new URL('api/auth', baseUrl).toString()}
                    label={t('issuer_url')}
                    copyLabel={t('copy')}
                  />
                </div>
                <Typography type='body-sm' className='col-span-12 pt-2 whitespace-pre-wrap'>
                  {t('msg_added_oidc_client')}
                </Typography>
              </GridBox>
            </StepMotion>
          )}
        </AnimatePresence>
      </div>
    </FormModal>
  )
}

export const UpdateModal: FC<
  ModalBaseProps & {
    target: UpdateOidcClient & {
      requirePkce: boolean
      tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
    }
  }
> = ({ state, reload, target }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpdateOidcClient>({
    resolver: zodResolver(scUpdateOidcClient),
    mode: 'onChange',
    defaultValues: {
      clientId: target.clientId,
      clientName: target.clientName,
      redirectUri: target.redirectUri,
      skipConsent: target.skipConsent,
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        await parseAction(updateOidcClient(req))
        notify.success(t('msg_updated_target', { target: req.clientName }))
        reload()
        state.close()
      })}
      title={{ text: t('update_client'), icon: <PencilSquareIcon /> }}
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
            name='clientName'
            label={t('client_name')}
            errorMessage={fet(errors.clientName)}
            isRequired
            autoFocus
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='redirectUri'
            label={t('redirect_uri')}
            errorMessage={fet(errors.redirectUri)}
            isRequired
          />
        </div>
        <div className='col-span-12'>
          <CheckBoxCtrl control={control} name='skipConsent' id='skipConsent' label={t('skip_consent')} />
        </div>
        <div className='col-span-12'>
          <CheckBoxField
            id='requirePkce'
            label={`${t('require_pkce')} (${t('immutable')})`}
            isSelected={target.requirePkce}
            isDisabled
          />
        </div>
        <div className='col-span-12'>
          <SingleSelectField
            label={`${t('token_endpoint_auth_method')} (${t('immutable')})`}
            value={target.tokenEndpointAuthMethod}
            onChange={() => {}}
            isDisabled
            groupOptions={{
              client_secret_basic: t('token_endpoint_auth_method_basic'),
              client_secret_post: t('token_endpoint_auth_method_post'),
            }}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}
