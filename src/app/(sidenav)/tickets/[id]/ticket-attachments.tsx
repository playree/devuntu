'use client'

import { AccordionSection } from '@/components/general/accordion'
import { PaperClipIcon, PhotoIcon } from '@/components/icon'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { ACCEPTED_IMAGE_TYPES } from '@/lib/schema/schema'
import { formatFileSize, toUploadUrl } from '@/lib/storage/upload'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { GetTicketReturnType } from './server'

type Ticket = NonNullable<GetTicketReturnType>

/**
 * 本文・コメントに貼られた画像とファイルの一覧。
 *
 * 添付はチケットではなく本文の記述に紐づくので、ここでは追加も削除もしない
 * (エディタの「ファイルを添付」で貼り、要らなくなったら本文からリンクを消す)。
 */
export const TicketAttachments: FC<{ ticket: Ticket }> = ({ ticket }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()

  const { attachments } = ticket
  if (attachments.length === 0) {
    return null
  }

  return (
    <AccordionSection
      id='attachments'
      icon={<PaperClipIcon />}
      title={`${t('ticket_attachments')} (${attachments.length})`}
    >
      <ul className='space-y-1'>
        {attachments.map((attachment) => (
          <li key={attachment.key} className='flex flex-wrap items-center gap-x-2 gap-y-1'>
            {ACCEPTED_IMAGE_TYPES.includes(attachment.mimeType) ? (
              <PhotoIcon width={14} className='text-muted shrink-0' />
            ) : (
              <PaperClipIcon width={14} className='text-muted shrink-0' />
            )}
            <a
              href={toUploadUrl(attachment.key)}
              download={attachment.originalName}
              className='min-w-0 truncate text-sm hover:underline'
            >
              {attachment.originalName}
            </a>
            <span className='text-muted text-xs'>{formatFileSize(attachment.size)}</span>
            <span className='text-muted ml-auto font-mono text-xs'>
              {dayformat(attachment.createdAt, 'tz-minute', tz)}
            </span>
          </li>
        ))}
      </ul>
    </AccordionSection>
  )
}
