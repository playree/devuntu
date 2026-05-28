'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input-ctrl'
import { FormModal, ModalBaseProps, useConfirmModal, useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import {
  CheckIcon,
  FingerPrintIcon,
  PencilSquareIcon,
  PlusCircleIcon,
  TableCellsIcon,
  UserCircleIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { authClient } from '@/lib/auth-client'
import { authConfig } from '@/lib/auth-config'
import { dayformat, now } from '@/lib/day'
import { envu, makeUrl } from '@/lib/env-util'
import { scUpdatePasskey, UpdatePasskey } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { Accordion, Table } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { useForm } from 'react-hook-form'

const getDeviceNameFromAaguid = (aaguid?: string) => {
  const aaguidMap: Record<string, string> = {
    'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain',
    'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
    '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
    '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
    '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
    'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  }

  return aaguidMap[aaguid ?? ''] ?? 'Any Device'
}

const UpdatePasskeyModal: FC<ModalBaseProps & { target: UpdatePasskey }> = ({ state, reload, target }) => {
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
        }
        state.close()
      })}
      title={{ text: t('update_passkey'), icon: <FingerPrintIcon /> }}
      hooter={
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
            variant='secondary'
            name='name'
            label={t('name')}
            errorMessage={fet(errors.name)}
            isRequired
            autoFocus
          />
        </div>
      </GridBox>
    </FormModal>
  )
}

const MyPasskey: FC = () => {
  const { t } = useLocale()
  const router = useRouter()
  const { confirmModal } = useConfirmModal()
  const { data: session } = authClient.useSession()
  const updateModalState = useModalState<UpdatePasskey>()

  const list = usePagingList({
    load: async () => {
      const res = await authClient.passkey.listUserPasskeys()
      if (res.data) {
        console.debug(res.data)
        return res.data.map(({ id, name, aaguid, createdAt }) => ({
          id,
          name: name ?? '',
          authenticator: getDeviceNameFromAaguid(aaguid),
          createdAt,
        }))
      }
      return []
    },
    sort: {
      init: { column: 'createdAt', direction: 'descending' },
    },
  })

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <div className='flex gap-1 pl-2'>
          <TableCellsIcon />
          {t('registered_passkeys')}
        </div>
        <MultiButton
          variant='ghost'
          size='sm'
          icon={<PlusCircleIcon />}
          onPress={async () => {
            const { data, error } = await authClient.passkey.addPasskey({
              name: `${envu.client.NEXT_PUBLIC_APP_NAME} (${dayformat(now(), 'jp-simple')})`,
              authenticatorAttachment: 'platform',
            })
            console.debug('addPasskey', { data, error })
            if (data?.id) {
              notify.success(t('msg_added_passkey'), { description: t('msg_added_passkey_description') })
              list.reload()
            }
            if (error?.status === 403) {
              try {
                const ok = await confirmModal().confirm({
                  title: t('re_auth'),
                  text: t('msg_re_auth'),
                  autoClose: false,
                })
                if (ok) {
                  router.push(
                    makeUrl(authConfig.path.signIn, {
                      cb: window.location.href,
                      re: session?.user.email ?? '',
                    }).toString(),
                  )
                }
              } finally {
                confirmModal().close()
              }
            }
          }}
        >
          {t('register_passkey')}
        </MultiButton>
      </div>
      <MultiTable
        ariaLabel='passkey list'
        pagingList={list}
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 160 },
          { id: 'authenticator', name: t('authenticator'), allowsSorting: true, minWidth: 200, defaultWidth: '2fr' },
          { id: 'createdAt', name: t('created_at'), allowsSorting: true, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell>{item.authenticator}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'jp-simple')}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'edit',
                  icon: <PencilSquareIcon />,
                  tooltip: t('update'),
                  onPress: () => {
                    updateModalState.open(item)
                  },
                },
                {
                  template: 'delete',
                  target: item.name ?? '',
                  action: async () => {
                    const { data } = await authClient.passkey.deletePasskey({ id: item.id })
                    if (data) {
                      notify.success(t('msg_deleted_target', { target: item.name }))
                      list.reload()
                    }
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      {updateModalState.target && (
        <UpdatePasskeyModal
          state={updateModalState}
          reload={list.reload}
          key={updateModalState.key}
          target={updateModalState.target}
        />
      )}
    </div>
  )
}

const defaultExpandedKeys = new Set(['passkey'])
export const AccountClient: FC = () => {
  const { t } = useLocale()

  return (
    <>
      <ContentHeader icon={<UserCircleIcon />} title={t('account')}></ContentHeader>
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <Accordion.Item id='passkey'>
          <Accordion.Heading>
            <Accordion.Trigger className='gap-1'>
              <FingerPrintIcon />
              {t('passkey')}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className='px-4'>
              <MyPasskey />
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </>
  )
}
