'use client'

import { MultiButton } from '@/components/general/button'
import { InputCtrl } from '@/components/general/input-ctrl'
import { FormModal, ModalBaseProps, useModalState } from '@/components/general/modal'
import { usePageingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CheckIcon, PlusIcon, UsersIcon } from '@/components/icon'
import { parseAction } from '@/lib/action-client'
import { AddOidcClient, scAddOidcClient } from '@/lib/schema'
import { gridStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { ButtonGroup, cn, Table, toast } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { addOidcClient, getOidcClients } from './server'

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
        toast.success(t('msg_added_oidc_client'))
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
  const addModalState = useModalState() //useOverlayState()

  const list = usePageingList({
    load: async () => {
      const res = await getOidcClients()
      return res.data ?? []
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
        <MultiButton isIconOnly>
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
          { id: 'name', name: t('client_name'), isRowHeader: true, allowsSorting: true },
          { id: 'email', name: t('client_id'), isRowHeader: true, allowsSorting: true },
        ]}
        paging={list}
      >
        {(item) => (
          <Table.Row key={item.client_id} id={item.client_id}>
            <Table.Cell>{item.client_name}</Table.Cell>
            <Table.Cell>{item.client_id}</Table.Cell>
          </Table.Row>
        )}
      </MultiTable>

      <AddModal state={addModalState} reload={list.reload} key={addModalState.key} />
    </>
  )
}
