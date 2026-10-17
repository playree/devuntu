'use client'

import { ArrowTopRightOnSquareIcon, InformationCircleIcon } from '@/components/icon'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Separator } from '@heroui/react'
import { getReleaseNotes } from '../server'
import { EditableLink, WidgetDataCard, WidgetFC } from './widget-card'

/**
 * リリースノート Widget。本文は要点だけを出し、詳細は GitHub のリリースページへリンクする
 */
export const ReleaseNoteWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getReleaseNotes)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<InformationCircleIcon />}
      title={t('release_note')}
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <div className='max-h-80 min-h-14 flex-1 overflow-y-auto'>
          {data.map((note) => {
            return (
              <div key={note.id}>
                <div className='text-base font-bold'>{note.name}</div>
                <MarkdownView body={note.summary} />
                {note.hasDetails && (
                  <EditableLink
                    href={note.url}
                    editable={editable}
                    isExternal
                    className='text-accent inline-flex items-center gap-1 text-sm hover:underline'
                  >
                    {t('release_note_details')}
                    <ArrowTopRightOnSquareIcon width={14} />
                  </EditableLink>
                )}
                <Separator className='my-2' />
              </div>
            )
          })}
        </div>
      )}
    </WidgetDataCard>
  )
}
