'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import { MultiSelectCtrl } from '@/components/general/select'
import { CheckIcon, PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { agentEmail, DUPLICATED_AGENT_HANDLE } from '@/lib/agent'
import { ClientError } from '@/lib/error'
import { CreateAgentIn, CreateAgentOut, scCreateAgent, scUpdateAgent, UpdateAgent } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { AgentRow } from './client'
import { createAgent, updateAgent } from './server'

export const AddModal: FC<ModalBaseProps & { groupOptions: Record<string, string> }> = ({
  state,
  reload,
  groupOptions,
}) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateAgentIn, unknown, CreateAgentOut>({
    resolver: zodResolver(scCreateAgent),
    mode: 'onChange',
    defaultValues: {
      name: '',
      handle: '',
      groups: [],
    },
  })

  // 入力中の識別子から出来上がるメールアドレスをその場で見せる
  const handle = useWatch({ control, name: 'handle' })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        try {
          const res = await parseAction(createAgent(req))
          notify.success(t('msg_added_target', { target: res.name }))
          reload()
          state.close()
        } catch (e) {
          if (e instanceof ClientError && e.errorType === DUPLICATED_AGENT_HANDLE) {
            notify.warn(t('msg_duplicated_agent_handle'))
          } else {
            throw e
          }
        }
      })}
      title={{ text: t('add_agent'), icon: <PlusIcon /> }}
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
            constraintSchema={scCreateAgent}
            label={t('name')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='handle'
            constraintSchema={scCreateAgent}
            label={t('agent_handle')}
            errorMessage={fet(errors.handle)}
          />
        </div>
        <div className='col-span-12'>
          <CopyableField text={handle ? agentEmail(handle) : ''} label={t('email')} copyLabel={t('copy')} />
        </div>
        <div className='col-span-12'>
          <NoticePanel className='text-xs'>{t('msg_agent_email_desc')}</NoticePanel>
        </div>
        <div className='col-span-12'>
          <MultiSelectCtrl control={control} name='groups' groupOptions={groupOptions} label={t('group')} />
        </div>
      </GridBox>
    </FormModal>
  )
}

export const UpdateModal: FC<ModalBaseProps & { target: AgentRow; groupOptions: Record<string, string> }> = ({
  state,
  reload,
  target,
  groupOptions,
}) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpdateAgent>({
    resolver: zodResolver(scUpdateAgent),
    mode: 'onChange',
    defaultValues: {
      id: target.id,
      name: target.name,
      groups: target.groups.map((group) => group.id),
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        await parseAction(updateAgent(req))
        notify.success(t('msg_updated_target', { target: req.name }))
        reload()
        state.close()
      })}
      title={{ text: t('update_agent'), icon: <PencilSquareIcon /> }}
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
            constraintSchema={scUpdateAgent}
            label={t('name')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
        <div className='col-span-12'>
          <CopyableField text={target.email} label={t('email')} copyLabel={t('copy')} />
        </div>
        <div className='col-span-12'>
          <NoticePanel className='text-xs'>{t('msg_agent_email_desc')}</NoticePanel>
        </div>
        <div className='col-span-12'>
          <MultiSelectCtrl control={control} name='groups' groupOptions={groupOptions} label={t('group')} />
        </div>
      </GridBox>
    </FormModal>
  )
}
