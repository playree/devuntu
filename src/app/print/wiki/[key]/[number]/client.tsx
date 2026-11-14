'use client'

import { getWikiPage } from '@/app/(sidenav)/wiki/[key]/[number]/server'
import { PanelSkeleton } from '@/components/general/panel'
import { BookOpenIcon } from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { PrintToolbar, useSaveHtml } from '@/components/print-export'
import { useActionData } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import type { PrintFormat } from '@/lib/print-export'
import { scGetWikiPageRevisionSnapshot } from '@/lib/schema/schema-wiki'
import { useWhenRendered } from '@/lib/use-when-rendered'
import { wikiExportFileName, wikiExportTitle } from '@/lib/wiki/wiki-export'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useRef } from 'react'
import { PrintWikiContent, PrintWikiDetail, PrintWikiPage } from './print-wiki-page'
import { getWikiPageRevisionSnapshot } from './server'

type Revision = NonNullable<Awaited<ReturnType<typeof getWikiPageRevisionSnapshot>>['data']>

/** いまの内容、または過去の版の内容 */
const toPrintContent = ({ page }: PrintWikiDetail, revision: Revision | undefined): PrintWikiContent =>
  revision
    ? {
        title: revision.title,
        type: revision.type,
        content: revision.content,
        tags: revision.tags,
        updatedBy: revision.actorName,
        updatedAt: revision.updatedAt,
        revisionNumber: revision.number,
      }
    : {
        title: page.title,
        type: page.type,
        content: page.content,
        tags: page.tags.map(({ tag }) => tag),
        updatedBy: page.updatedBy?.name ?? page.createdBy?.name ?? '',
        updatedAt: page.updatedAt,
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
  // 形式の合わない版 ID(手で書き換えた URL など)は引かずに、存在しない版と同じ扱いにする(入力エラーの通知を出さない)
  const isValidRevision = !revisionId || scGetWikiPageRevisionSnapshot.shape.revisionId.safeParse(revisionId).success
  const pageId = detail?.page.id
  const { data: revision, isLoading: isRevisionLoading } = useActionData(
    () => getWikiPageRevisionSnapshot({ pageId: pageId ?? '', revisionId: revisionId ?? '' }),
    { skip: !pageId || !revisionId || !isValidRevision, key: pageId },
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
