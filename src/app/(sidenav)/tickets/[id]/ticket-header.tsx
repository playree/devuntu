'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { ContentHeader } from '@/components/header'
import { TicketIcon, ViewColumnsIcon, XMarkIcon } from '@/components/icon'
import { useBoardName } from '@/components/ticket/ticket-options'
import { useLocale } from '@/locale/client'
import { Breadcrumbs } from '@heroui/react'
import { FC } from 'react'
import { GetTicketReturnType } from './server'

/**
 * ヘッダの閉じるボタン。
 * 一覧に埋め込んだときだけ出す。単独ページではパンくずが上位への導線になるため置かない。
 */
export const CloseButton: FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLocale()
  return <MultiButton isIconOnly variant='ghost' tooltip={t('close')} icon={<XMarkIcon />} onPress={onClose} />
}

/**
 * ヘッダのパンくず。ボード名 > 件名 の 2 階層。
 * 長い名前は幅で省略する。件名のリンクは、サイド表示中の詳細を単独ページとして開くための導線。
 */
const TicketBreadcrumbs: FC<{ ticketId: string; boardId: string; boardName: string; title: string }> = ({
  ticketId,
  boardId,
  boardName,
  title,
}) => (
  <Breadcrumbs className='min-w-0'>
    <Breadcrumbs.Item href={`/boards/${boardId}`}>
      <span className='flex items-center gap-1'>
        <ViewColumnsIcon width={16} />
        <span className='max-w-32 truncate sm:max-w-48'>{boardName}</span>
      </span>
    </Breadcrumbs.Item>
    <Breadcrumbs.Item
      href={`/tickets/${ticketId}`}
      isDisabled={false} // react-aria は最後の項目を現在地として無効化するため、明示的に打ち消してリンクにする
    >
      <span className='flex items-center gap-1'>
        <TicketIcon width={16} />
        <span className='max-w-40 truncate sm:max-w-72'>{title}</span>
      </span>
    </Breadcrumbs.Item>
  </Breadcrumbs>
)

type Ticket = NonNullable<GetTicketReturnType>

/** 詳細画面のヘッダ。閉じるボタン(埋め込み時のみ)・パンくず・表示IDのコピー */
export const TicketHeader: FC<{ ticket: Ticket; onClose?: () => void }> = ({ ticket, onClose }) => {
  const { t } = useLocale()
  const boardName = useBoardName()
  const id = ticket.id

  return (
    <ContentHeader
      title={
        <>
          {onClose && <CloseButton onClose={onClose} />}
          <TicketBreadcrumbs
            ticketId={id}
            boardId={ticket.boardId}
            boardName={boardName({ name: ticket.boardName, kind: ticket.boardKind })}
            title={ticket.title}
          />
          <CopyableField // 表示IDを見せつつ、チャットや議事録へそのまま貼れるURLをコピーさせる
            // 幅を固定しないと input の既定幅で狭い画面のパンくずを潰してしまう
            className='w-36 shrink-0'
            isSmart
            text={ticket.displayId}
            copyText={ticket.shortUrl}
            aria-label={t('id')}
            copyLabel={t('copy_url')}
          />
        </>
      }
    />
  )
}
