'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal, useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import {
  BoltSlashIcon,
  Cog6ToothIcon,
  FingerPrintIcon,
  GoogleIcon,
  PencilSquareIcon,
  PlusIcon,
  UserCircleIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { aaguidMap } from '@/lib/aaguid'
import { parseAction } from '@/lib/action-client'
import { authClient } from '@/lib/auth-client'
import { authConfig } from '@/lib/auth-config'
import { makePath } from '@/lib/client-utils'
import { COMMON_TIMEZONES, dayformat, now, tzOffsetLabel, tzOffsetMinutes } from '@/lib/day'
import { envu } from '@/lib/env-util'
import { formatScopeLabel, GOOGLE_ACCOUNT_PROVIDER_ID } from '@/lib/google-calendar'
import { UpdatePasskey } from '@/lib/schema'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Accordion, ButtonGroup, ListBox, Select, Table } from '@heroui/react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useMemo, useState } from 'react'
import { UpdatePasskeyModal } from './modals'
import {
  disconnectGoogleAccount,
  getGoogleAccountStatus,
  GetGoogleAccountStatusReturnType,
  setUserTimezone,
} from './server'

const getDeviceNameFromAaguid = (aaguid?: string) => {
  return aaguidMap[aaguid ?? ''] ? aaguidMap[aaguid ?? ''] : { name: 'Any Device' }
}

const MyPasskey: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()
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
    <FlexCol>
      <ContentHeader className='text-foreground'>
        <MultiButton
          icon={<PlusIcon />}
          onPress={async () => {
            const { data, error } = await authClient.passkey.addPasskey({
              name: `${envu.client.NEXT_PUBLIC_APP_NAME} (${dayformat(now(), 'jp-simple', tz)})`,
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
                    makePath(authConfig.path.signIn, {
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
      </ContentHeader>

      <MultiTable
        ariaLabel='passkey list'
        pagingList={list}
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 200, defaultWidth: '1fr' },
          { id: 'authenticator', name: t('authenticator'), allowsSorting: true, minWidth: 200, defaultWidth: '1fr' },
          { id: 'createdAt', name: t('created_at'), allowsSorting: true, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell>
              <div className='flex items-center gap-2'>
                {item.authenticator.icon_dark && (
                  <Image src={item.authenticator.icon_dark} width={20} height={20} alt='' className='h-5 w-auto' />
                )}
                {item.authenticator.name}
              </div>
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'jp-simple', tz)}</Table.Cell>
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
    </FlexCol>
  )
}

const GoogleAccountLink: FC = () => {
  const { t } = useLocale()
  const { confirmModal } = useConfirmModal()
  const [status, setStatus] = useState<GetGoogleAccountStatusReturnType>()

  const reload = () => {
    parseAction(getGoogleAccountStatus()).then((res) => setStatus(res))
  }

  useEffect(() => {
    reload()
  }, [])

  const link = async () => {
    // カレンダー連携専用プロバイダ(google-account)にリンク
    // (scopes/offline/consent はサーバーのプロバイダ設定側で固定)
    await authClient.oauth2.link({
      providerId: GOOGLE_ACCOUNT_PROVIDER_ID,
      callbackURL: '/account',
    })
  }

  const connected = status?.connected

  return (
    <FlexCol>
      {connected ? (
        <ContentHeader title={t('msg_google_account_connected')} className='text-foreground'>
          <MultiButton icon={<GoogleIcon />} onPress={link}>
            {t('account_relink')}
          </MultiButton>
          <MultiButton
            icon={<BoltSlashIcon />}
            onPress={async () => {
              const ok = await confirmModal().confirm({
                title: t('account_disconnect'),
                text: t('msg_google_account_connected'),
              })
              if (ok) {
                await parseAction(disconnectGoogleAccount())
                notify.success(t('account_disconnect'))
                reload()
              }
            }}
          >
            <ButtonGroup.Separator />
            {t('account_disconnect')}
          </MultiButton>
        </ContentHeader>
      ) : (
        <ContentHeader title={t('msg_google_account_not_connected')}>
          <MultiButton icon={<GoogleIcon />} onPress={link}>
            {t('account_connect')}
          </MultiButton>
        </ContentHeader>
      )}

      {connected && !!status?.scopes.length && (
        <div className='px-1'>
          <div className='mb-1 text-sm font-bold'>{t('granted_scopes')}</div>
          <MultiTable
            ariaLabel='granted scopes'
            columns={[{ id: 'scope', name: t('scope'), isRowHeader: true, defaultWidth: '1fr' }]}
            items={status.scopes.map((scope) => ({ id: scope, scope }))}
          >
            {(item) => (
              <Table.Row key={item.id} id={item.id}>
                <Table.Cell className='font-mono text-xs'>{formatScopeLabel(item.scope)}</Table.Cell>
              </Table.Row>
            )}
          </MultiTable>
        </div>
      )}
    </FlexCol>
  )
}

const TimezoneSetting: FC = () => {
  const { t } = useLocale()
  const { data: session } = authClient.useSession()
  const [selected, setSelected] = useState<string | null>(null)

  // 現在値は session の timezone、未設定時は Asia/Tokyo。変更後は selected を優先
  const current = session?.user.timezone ?? 'Asia/Tokyo'
  const value = selected ?? current

  // 主要都市をオフセット順に表示。現在値が候補外なら先頭にマージして必ず表示できるようにする
  const timezones = useMemo(() => {
    const base = COMMON_TIMEZONES.includes(value) ? COMMON_TIMEZONES : [value, ...COMMON_TIMEZONES]
    return [...base].sort((a, b) => tzOffsetMinutes(a) - tzOffsetMinutes(b))
  }, [value])

  return (
    <FlexCol>
      <div className='max-w-sm px-1'>
        <Select
          selectionMode='single'
          value={value}
          onChange={async (key) => {
            if (!key) {
              return
            }
            const tz = key.toString()
            setSelected(tz)
            await parseAction(setUserTimezone({ timezone: tz }))
            notify.success(t('msg_saved'))
          }}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox selectionMode='single'>
              {timezones.map((tz) => (
                <ListBox.Item key={tz} id={tz} textValue={tzOffsetLabel(tz)}>
                  {tzOffsetLabel(tz)}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
    </FlexCol>
  )
}

const defaultExpandedKeys = new Set(['passkey', 'google_account', 'timezone'])
export const AccountClient: FC = () => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <ContentHeader icon={<UserCircleIcon />} title={t('account')}></ContentHeader>
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <Accordion.Item id='timezone'>
          <Accordion.Heading>
            <Accordion.Trigger className='gap-1'>
              <Cog6ToothIcon />
              {t('timezone')}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className='px-4'>
              <TimezoneSetting />
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
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
        <Accordion.Item id='google_account'>
          <Accordion.Heading>
            <Accordion.Trigger className='gap-1'>
              <GoogleIcon />
              {t('google_account')}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className='px-4'>
              <GoogleAccountLink />
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </FlexCol>
  )
}
