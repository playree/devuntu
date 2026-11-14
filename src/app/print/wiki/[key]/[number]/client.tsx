'use client'

import { getWikiPage } from '@/app/(sidenav)/wiki/[key]/[number]/server'
import { getWikiPageRevisionSnapshot } from '@/app/(sidenav)/wiki/[key]/server'
import { PanelSkeleton } from '@/components/general/panel'
import { BookOpenIcon } from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { PrintToolbar, useSaveHtml } from '@/components/print-export'
import { useActionData } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import type { PrintFormat } from '@/lib/print-export'
import { useWhenRendered } from '@/lib/use-when-rendered'
import { wikiExportFileName, wikiExportTitle } from '@/lib/wiki/wiki-export'
import type { WikiPageRevisionSummary } from '@/lib/wiki/wiki-revision'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useRef } from 'react'
import { PrintWikiContent, PrintWikiDetail, PrintWikiPage } from './print-wiki-page'

/** いまの内容、または過去の版の内容。タグの色は名前でいまのページのタグから引き、無ければ灰色にする */
const toPrintContent = (
  { page }: PrintWikiDetail,
  revision: (WikiPageRevisionSummary & { content: string }) | undefined,
): PrintWikiContent => {
  const pageTags = page.tags.map(({ tag }) => tag)
  if (!revision) {
    return {
      title: page.title,
      type: page.type,
      content: page.content,
      tags: pageTags,
      updatedBy: page.updatedBy?.name ?? page.createdBy?.name ?? '',
      updatedAt: page.updatedAt,
    }
  }
  return {
    title: revision.title,
    type: revision.type,
    content: revision.content,
    tags: revision.tagNames.map(
      (name) => pageTags.find((tag) => tag.name === name) ?? { id: name, name, color: 'gray' as const },
    ),
    updatedBy: revision.actorName,
    updatedAt: revision.updatedAt,
    revisionNumber: revision.number,
  }
}

/**
 * Wiki ページの印刷用ページ。revisionId を渡すとその版の内容、無ければいまの内容を出す。
 * 描画が終わったら format に応じて印刷ダイアログを開くか、HTML を保存する。
 * 認可はページ詳細と同じ getWikiPage(版は getWikiPageRevisionSnapshot)で行う
 */
export const WikiPrintClient: FC<{ spaceKey: string; number: number; revisionId?: string; format: PrintFormat }> = ({
  spaceKey,
  number,
  revisionId,
  format,
}) => {
  const { t } = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const isValidNumber = Number.isInteger(number) && number > 0
  const { data: detail, isLoading } = useActionData(() => getWikiPage({ key: spaceKey, number }), {
    skip: !isValidNumber,
  })
  const pageId = detail?.page.id
  const { data: revision, isLoading: isRevisionLoading } = useActionData(
    () => getWikiPageRevisionSnapshot({ pageId: pageId ?? '', revisionId: revisionId ?? '' }),
    { skip: !pageId || !revisionId, key: pageId },
  )
  // 日時をユーザーのタイムゾーンで出すため、セッションの取得も待つ((sidenav) の SessionPending の外にあるため)
  const { isPending: isSessionPending } = authClient.useSession()

  const isFound = !!detail && (!revisionId || !!revision)
  const content = isFound ? toPrintContent(detail, revision) : undefined
  const documentTitle =
    detail && content
      ? wikiExportTitle({
          key: detail.space.key,
          number: detail.page.number,
          title: content.title,
          revisionNumber: content.revisionNumber,
        })
      : undefined

  useEffect(() => {
    if (documentTitle) {
      document.title = documentTitle
    }
  }, [documentTitle])

  const { save: saveHtml, isPending: isSavingHtml } = useSaveHtml(
    ref,
    documentTitle ? { title: documentTitle, fileName: wikiExportFileName(documentTitle, 'html') } : undefined,
  )

  useWhenRendered(ref, isFound && !isSessionPending, () => (format === 'html' ? void saveHtml() : window.print()))

  if (isLoading || isRevisionLoading) {
    return <PanelSkeleton />
  }

  return (
    <div className='mx-auto w-full max-w-3xl p-4 print:max-w-none print:p-0'>
      {detail && content ? (
        <>
          <PrintToolbar format={format} onSaveHtml={() => void saveHtml()} isSavingHtml={isSavingHtml} />
          <div ref={ref}>
            <PrintWikiPage detail={detail} content={content} />
          </div>
        </>
      ) : (
        <NoAccessView icon={<BookOpenIcon />} title={t('wiki')} />
      )}
    </div>
  )
}
