'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { InputField } from '@/components/general/input'
import { GithubIcon, PlusIcon, XMarkIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { CiStatusChip, PullRequestStateChip } from '@/components/ticket/ticket-link-chip'
import { parseAction } from '@/lib/action/action-client'
import { ticketLinkLabel } from '@/lib/github/github'
import { zGithubUrl } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { addTicketLink, GetTicketReturnType, removeTicketLink } from './server'

type Ticket = NonNullable<GetTicketReturnType>
type Link = Ticket['links'][number]

const LinkItem: FC<{ link: Link; canEdit: boolean; refresh: () => Promise<void> }> = ({ link, canEdit, refresh }) => {
  const { t } = useLocale()
  const [isRemoving, setRemoving] = useState(false)

  const remove = async () => {
    setRemoving(true)
    try {
      await parseAction(removeTicketLink({ id: link.id }))
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setRemoving(false)
    }
  }

  return (
    <li className='flex flex-wrap items-center gap-x-2 gap-y-1'>
      <a href={link.url} target='_blank' rel='noopener noreferrer' className='min-w-0 truncate text-sm hover:underline'>
        <span className='font-mono'>{ticketLinkLabel(link)}</span>
        {link.title && <span className='text-muted ml-2'>{link.title}</span>}
      </a>
      {link.prState && <PullRequestStateChip value={link.prState} />}
      {link.ci && <CiStatusChip value={link.ci} />}
      {canEdit && (
        <MultiButton
          isIconOnly
          size='sm'
          variant='ghost'
          className='ml-auto'
          tooltip={t('unlink')}
          icon={<XMarkIcon width={16} />}
          isPending={isRemoving}
          onPress={remove}
        />
      )}
    </li>
  )
}

/** 紐付けたブランチ / PR / コミットの一覧と、URL を貼っての追加 */
export const TicketLinks: FC<{ ticket: Ticket; refresh: () => Promise<void> }> = ({ ticket, refresh }) => {
  const { t } = useLocale()
  const [url, setUrl] = useState('')
  const [isAdding, setAdding] = useState(false)
  const [isInvalid, setInvalid] = useState(false)

  const { links, canEdit } = ticket
  // 編集できない人に空の見出しだけを見せても意味が無い
  if (links.length === 0 && !canEdit) {
    return null
  }

  const add = async () => {
    if (!zGithubUrl.safeParse(url).success) {
      setInvalid(true)
      return
    }
    setAdding(true)
    try {
      await parseAction(addTicketLink({ ticketId: ticket.id, url }))
      notify.success(t('msg_saved'))
      setUrl('')
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる。貼り直さずに済むよう入力は残す
    } finally {
      setAdding(false)
    }
  }

  return (
    <FlexCol isSmart className='pb-4'>
      <div className='flex items-center gap-2'>
        <GithubIcon />
        <span>
          {t('ticket_links')} ({links.length})
        </span>
      </div>

      {links.length > 0 && (
        <ul className='space-y-1'>
          {links.map((link) => (
            <LinkItem key={link.id} link={link} canEdit={canEdit} refresh={refresh} />
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          className='flex items-start gap-2'
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <div className='grow'>
            <InputField
              isSmart
              isLabelHidden
              label={t('ticket_link_url')}
              aria-label={t('ticket_link_url')}
              placeholder='https://github.com/owner/repo/pull/123'
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setInvalid(false)
              }}
              errorMessage={isInvalid ? t('@invalid_github_url') : undefined}
            />
          </div>
          <MultiButton
            type='submit'
            size='sm'
            variant='outline'
            icon={<PlusIcon width={16} />}
            isPending={isAdding}
            isDisabled={!url.trim()}
          >
            {t('add_link')}
          </MultiButton>
        </form>
      )}
    </FlexCol>
  )
}
