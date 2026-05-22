'use client'

import { MultiButton } from '@/components/general/button'
import { OnOffChip } from '@/components/general/chip'
import { CopyableField } from '@/components/general/copyable-field'
import { InputCtrl } from '@/components/general/input-ctrl'
import { FormModal, ModalBaseProps, useConfirmModal, useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { StepMotion } from '@/components/general/step-motion'
import { ActionCell, MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CheckIcon, PencilSquareIcon, PlusIcon, TrashIcon, UsersIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { AddOidcClient, scAddOidcClient } from '@/lib/schema'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { ButtonGroup, cn, Table } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence } from 'framer-motion'
import { FC, useState } from 'react'
import { useForm } from 'react-hook-form'
import { addOidcClient, deleteOidcClient, getOidcClients } from './server'

type Step = {
  id: 'INPUT' | 'OUTPUT'
  direction: number
}

const AddModal: FC<ModalBaseProps> = ({ state, reload }) => {
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
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(addOidcClient(req))
        setOutput(res)
        setStep({ id: 'OUTPUT', direction: 1 })
        notify.success(t('msg_added_target', { target: req.clientName }))
        reload()
      })}
      title={{ text: t('add_client'), icon: <PlusIcon /> }}
      hooter={
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
      <div className='min-h-46 overflow-hidden'>
        <AnimatePresence mode='wait' custom={step.direction}>
          {step.id === 'INPUT' && (
            <StepMotion direction={step.direction} key='step_input'>
              <div className={cn(gridStyles(), 'mt-4 p-1')}>
                <div className='col-span-12'>
                  <InputCtrl
                    control={control}
                    variant='secondary'
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
                    variant='secondary'
                    name='redirectUri'
                    label={t('redirect_uri')}
                    errorMessage={fet(errors.redirectUri)}
                    isRequired
                  />
                </div>
              </div>
            </StepMotion>
          )}

          {step.id === 'OUTPUT' && output && (
            <StepMotion direction={step.direction} key='step_output'>
              <div className={cn(gridStyles(), 'mt-4 p-1')}>
                <div className='col-span-12'>
                  <CopyableField text={output.clientId} label={t('client_id')} variant='secondary' />
                </div>
                <div className='col-span-12'>
                  <CopyableField text={output.clientSecret} label={t('client_secret')} isMask variant='secondary' />
                </div>
              </div>
            </StepMotion>
          )}
        </AnimatePresence>
      </div>
    </FormModal>
  )
}

export const OidcListClient: FC = () => {
  const { t } = useLocale()
  const addModalState = useModalState()
  const { confirmModal } = useConfirmModal()

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getOidcClients())
      return res ?? []
    },
    sort: {
      init: { column: 'updatedAt', direction: 'descending' },
    },
  })

  return (
    <>
      <ContentHeader icon={<UsersIcon />} title={t('oidc_clients')}>
        <MultiButton isIconOnly tooltip={t('add_client')} onPress={addModalState.open}>
          <PlusIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => list.reload()}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        ariaLabel='user list'
        pagingList={list}
        columns={[
          {
            id: 'clientName',
            name: t('client_name'),
            isRowHeader: true,
            allowsSorting: true,
            minWidth: 120,
            defaultWidth: '1fr',
          },
          { id: 'clientId', name: t('client_id'), allowsSorting: true, minWidth: 200, defaultWidth: '2fr' },
          { id: 'skipConsent', name: t('skip_consent'), allowsSorting: false, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 120 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.clientId} id={item.clientId}>
            <Table.Cell>{item.clientName}</Table.Cell>
            <Table.Cell className='font-mono'>{item.clientId}</Table.Cell>
            <Table.Cell>
              <OnOffChip isState={item.skipConsent} />
            </Table.Cell>
            <ActionCell
              items={[
                { key: 'edit', icon: <PencilSquareIcon /> },
                {
                  key: 'delete',
                  variant: 'danger-soft',
                  icon: <TrashIcon />,
                  onPress: async () => {
                    try {
                      const ok = await confirmModal().confirm({
                        title: t('confirm_deletion'),
                        text: t('msg_confirm_deletion', { target: item.clientName }),
                        requireCheck: true,
                        autoClose: false,
                      })
                      if (ok) {
                        await parseAction(deleteOidcClient({ clientId: item.clientId }))
                        notify.success(t('msg_deleted_target', { target: item.clientName }))
                        list.reload()
                      }
                    } finally {
                      confirmModal().close()
                    }
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <AddModal state={addModalState} reload={list.reload} key={addModalState.key} />
    </>
  )
}
