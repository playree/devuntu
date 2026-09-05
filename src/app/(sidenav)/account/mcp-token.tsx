'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { NoticePanel } from '@/components/general/panel'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { dayformat, nowDate } from '@/lib/day'
import { MAX_MCP_TOKENS_PER_USER } from '@/lib/token-expires'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Chip, Table } from '@heroui/react'
import { FC } from 'react'
import { IssueMcpTokenModal } from './modals'
import { deleteMcpToken, getMyMcpTokens } from './server'

/** 期限切れは検証側で弾かれるので、本人に削除を促すために一覧で見えるようにする */
const ExpiryChip: FC<{ expiresAt: Date | null }> = ({ expiresAt }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()

  if (!expiresAt) {
    return <span className='text-xs opacity-70'>{t('no_expiration')}</span>
  }
  const isExpired = expiresAt <= nowDate()
  return (
    <div className='flex items-center gap-2'>
      <span className='font-mono text-xs'>{dayformat(expiresAt, 'tz-simple', tz)}</span>
      {isExpired && (
        <Chip color='warning' variant='soft'>
          {t('token_expired')}
        </Chip>
      )}
    </div>
  )
}

/**
 * ユーザー自身の MCP トークン管理。
 *
 * 平文は発行の応答でしか受け取れないため、発行モーダルの中で一度だけ見せる。
 * 失効は行の削除で行うので、再発行という操作は用意しない(消して発行し直す)。
 */
export const MyMcpTokens: FC<{ baseUrl: string }> = ({ baseUrl }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const issueModalState = useModalState()

  const list = usePagingList({
    load: async () => await parseAction(getMyMcpTokens()),
    sort: {
      init: { column: 'createdAt', direction: 'descending' },
    },
  })

  const isFull = list.total >= MAX_MCP_TOKENS_PER_USER

  return (
    <FlexCol>
      <ContentHeader className='text-foreground'>
        <MultiButton icon={<PlusIcon />} isDisabled={isFull} onPress={() => issueModalState.open()}>
          {t('issue_token')}
        </MultiButton>
      </ContentHeader>

      <MultiTable
        isSmart
        ariaLabel='mcp token list'
        pagingList={list}
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 160, defaultWidth: '1fr' },
          { id: 'hint', name: t('mcp_token'), allowsSorting: false, minWidth: 110 },
          { id: 'expiresAt', name: t('token_expiration'), allowsSorting: true, minWidth: 150 },
          { id: 'lastUsedAt', name: t('last_used'), allowsSorting: true, minWidth: 130 },
          { id: 'createdAt', name: t('issued_at'), allowsSorting: true, minWidth: 130 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>…{item.hint}</Table.Cell>
            <Table.Cell>
              <ExpiryChip expiresAt={item.expiresAt} />
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>
              {item.lastUsedAt ? dayformat(item.lastUsedAt, 'tz-simple', tz) : '-'}
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'tz-simple', tz)}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'delete',
                  target: item.name,
                  action: async () => {
                    await parseAction(deleteMcpToken({ id: item.id }))
                    notify.success(t('msg_deleted_target', { target: item.name }))
                    list.reload()
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <NoticePanel className='text-xs' status={isFull ? 'warning' : undefined}>
        {isFull ? t('msg_mcp_token_limit', { max: MAX_MCP_TOKENS_PER_USER }) : t('msg_mcp_token_desc')}
      </NoticePanel>
      {list.total > 0 && <NoticePanel className='text-xs'>{t('msg_confirm_delete_mcp_token')}</NoticePanel>}

      <IssueMcpTokenModal state={issueModalState} reload={list.reload} key={issueModalState.key} baseUrl={baseUrl} />
    </FlexCol>
  )
}
