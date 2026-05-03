'use client'

import { MultiButton } from '@/components/general/button'
import { OnOffChip } from '@/components/general/chip'
import { InputCtrl } from '@/components/general/input-ctrl'
import { FormModal, ModalBaseProps, useConfirmModal, useModalState } from '@/components/general/modal'
import { usePageingList } from '@/components/general/paging'
import { ActionCell, MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CheckIcon, PencilSquareIcon, PlusIcon, TrashIcon, UsersIcon } from '@/components/icon'
import { parseAction } from '@/lib/action-client'
import { AddOidcClient, scAddOidcClient } from '@/lib/schema'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { ButtonGroup, cn, Table, toast } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { addOidcClient, deleteOidcClient, getOidcClients } from './server'

const AddModal: FC<ModalBaseProps> = ({ state, reload }) => {
  const { t, fet } = useLocale()

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
        await parseAction(addOidcClient(req))
        toast.success(t('msg_added_target', { target: req.clientName }))
        reload()
        state.close()
      })}
      title={{ text: t('add_client'), icon: <PlusIcon /> }}
      hooter={
        <>
          <MultiButton slot='close' variant='secondary'>
            {t('cancel')}
          </MultiButton>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('ok')}
          </MultiButton>
        </>
      }
    >
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
    </FormModal>
  )
}

export const OidcListClient: FC = () => {
  const { t } = useLocale()
  const addModalState = useModalState()
  const { confirmModal } = useConfirmModal()

  const list = usePageingList({
    load: async () => {
      const res = await parseAction(getOidcClients())
      return res ?? []
    },
    sort: {
      init: { column: 'updatedAt', direction: 'descending' },
    },
    rowsPerPage: 4,
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
        items={list.items}
        sortDescriptor={list.sortDescriptor}
        onSortChange={list.onSortChange}
        columns={[
          { id: 'client_name', name: t('client_name'), isRowHeader: true, allowsSorting: true },
          { id: 'client_id', name: t('client_id'), allowsSorting: true },
          { id: 'consent', name: t('skip_consent'), allowsSorting: false },
          { id: 'action', name: t('action'), allowsSorting: false },
        ]}
        paging={list}
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
                        toast.success(t('msg_deleted_target', { target: item.clientName }))
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
