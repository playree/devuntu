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
          <Table.Row key={item.client_id} id={item.client_id}>
            <Table.Cell>{item.client_name}</Table.Cell>
            <Table.Cell className='font-mono'>{item.client_id}</Table.Cell>
            <Table.Cell>
              <OnOffChip isState={item.skip_consent} />
            </Table.Cell>
            <ActionCell
              items={[
                { key: 'edit', icon: <PencilSquareIcon /> },
                {
                  key: 'delete',
                  variant: 'danger-soft',
                  icon: <TrashIcon />,
                  onPress: () => {
                    confirmModal().confirm({
                      title: 'Title',
                      text: 'Text',
                      requireCheck: true,
                    })
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
