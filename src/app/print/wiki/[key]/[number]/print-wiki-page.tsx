'use client'

import type { GetWikiPageReturnType } from '@/app/(sidenav)/wiki/[key]/[number]/server'
import { DesignDocPrintView } from '@/components/markdown/design-doc-print-view'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { TagChips } from '@/components/ticket/ticket-chip'
import type { TagColor, WikiPageType } from '@/generated/prisma/enums'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { wikiPageRef } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

export type PrintWikiDetail = NonNullable<GetWikiPageReturnType>

/** 出力する内容。いまの内容か、過去の版の内容 */
export type PrintWikiContent = {
  title: string
  type: WikiPageType
  content: string
  tags: { id: string; name: string; color: TagColor }[]
  updatedBy: string
  updatedAt: Date
  /** 過去の版のときの版数 */
  revisionNumber?: number
}

/** Wiki ページ 1 件の印刷用の表示。見出し(ページの指定・スペースとパンくず・タイトル・版・更新者・タグ)と本文 */
export const PrintWikiPage: FC<{ detail: PrintWikiDetail; content: PrintWikiContent }> = ({ detail, content }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { space, page, ancestors } = detail
  return (
    <>
      <header className='border-b pb-2'>
        <div className='text-muted flex flex-wrap items-center gap-x-3 text-xs'>
          <span className='font-mono'>{wikiPageRef({ key: space.key, number: page.number })}</span>
          <span className='wrap-anywhere'>{[space.name, ...ancestors.map(({ title }) => title)].join(' › ')}</span>
        </div>
        <h1 className='mt-1 text-xl font-semibold wrap-anywhere'>{content.title}</h1>
        <div className='text-muted mt-1 flex flex-wrap items-center gap-2 text-xs'>
          {content.revisionNumber !== undefined && <span className='font-mono'>v{content.revisionNumber}</span>}
          <span>
            {t('wiki_updated_by', {
              name: content.updatedBy || '-',
              at: dayformat(content.updatedAt, 'tz-minute', tz),
            })}
          </span>
          <TagChips tags={content.tags} />
        </div>
      </header>
      <div className='mt-4'>
        {!content.content.trim() ? (
          <div className='text-sm'>-</div>
        ) : content.type === 'design_doc' ? (
          <DesignDocPrintView markdown={content.content} />
        ) : (
          <MarkdownView body={content.content} />
        )}
      </div>
    </>
  )
}
