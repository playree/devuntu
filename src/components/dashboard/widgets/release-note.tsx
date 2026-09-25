'use client'

import { InformationCircleIcon } from '@/components/icon'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Separator } from '@heroui/react'
import { getReleaseNotes } from '../server'
import { WidgetDataCard, WidgetFC } from './widget-card'

/**
 * リリースノート Widget。
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
                <MarkdownView body={note.body} />
                <Separator className='my-2' />
              </div>
            )
          })}
        </div>
      )}
    </WidgetDataCard>
  )
}
