'use client'

import { MultiButton } from '@/components/general/button'
import { PrinterIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { buildHtmlDocument, collectPageCss, downloadHtml, snapshotElement } from '@/lib/html-export'
import { isPrintHtmlMessage, PRINT_HTML_MESSAGE, PRINT_PATH_PREFIX, type PrintHtmlMessage } from '@/lib/print-export'
import { useLocale } from '@/locale/client'
import { FC, RefObject, useEffect, useRef, useState } from 'react'

/** 印刷用ページが、出力メニューの見えない iframe の中に開かれているか */
const isInExportFrame = () => window.parent !== window

/** 親(出力メニューのある画面)へ HTML またはエラーを返す */
const postToParent = (message: PrintHtmlMessage) => window.parent.postMessage(message, window.location.origin)

/**
 * 印刷用ページの描画結果を、画像と CSS を埋め込んだ 1 つの HTML にする。
 * 見えない iframe の中なら親へ返し(親がダウンロードする)、直接開かれていれば自分でダウンロードする
 */
export const useSaveHtml = (
  ref: RefObject<HTMLElement | null>,
  doc: { title: string; fileName: string } | undefined,
) => {
  const { t } = useLocale()
  const save = async () => {
    const container = ref.current
    if (!container || !doc) {
      return
    }
    try {
      const html = buildHtmlDocument({
        title: doc.title,
        lang: document.documentElement.lang,
        htmlClass: document.documentElement.className,
        bodyClass: document.body.className,
        css: collectPageCss(),
        body: await snapshotElement(container),
      })
      if (isInExportFrame()) {
        postToParent({ type: PRINT_HTML_MESSAGE, fileName: doc.fileName, html })
        return
      }
      downloadHtml(doc.fileName, html)
    } catch {
      if (isInExportFrame()) {
        postToParent({ type: PRINT_HTML_MESSAGE, error: true })
        return
      }
      notify.error(t('msg_save_html_failed'))
    }
  }
  return save
}

/** 見えない iframe の中で対象を取得できなかったとき、親がタイムアウトまで待たないようにエラーを返す */
export const useReportNotFoundToParent = (isNotFound: boolean) => {
  useEffect(() => {
    if (isNotFound && isInExportFrame()) {
      postToParent({ type: PRINT_HTML_MESSAGE, error: true })
    }
  }, [isNotFound])
}

/** 見えない iframe で HTML を作るのを待つ上限。印刷用ページの読み込み・描画の待ち(最大 10 秒)・画像の取得を含む */
const FRAME_EXPORT_TIMEOUT = 60_000

/**
 * 印刷用ページ(`?format=html`)を見えない iframe に開き、そのページが作った HTML を受け取る。
 * iframe は 1px に切り抜いた枠に入れて画面内に置く(画面外や display: none だと requestAnimationFrame が止まり、描画の完了を待てない。
 * 枠で切り抜くのは、スマホの幅より広い iframe でページが横にはみ出さないようにするため)
 */
const renderHtmlInFrame = (path: string, signal: AbortSignal): Promise<{ fileName: string; html: string }> =>
  new Promise((resolve, reject) => {
    const box = document.createElement('div')
    box.setAttribute('aria-hidden', 'true')
    box.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1'
    const frame = document.createElement('iframe')
    frame.tabIndex = -1
    frame.style.cssText = 'width:1024px;height:768px;border:0'
    box.append(frame)

    const finish = () => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
      box.remove()
    }
    const fail = (reason: unknown) => {
      finish()
      reject(reason)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== window.location.origin) {
        return
      }
      if (!isPrintHtmlMessage(event.data)) {
        return
      }
      if ('error' in event.data) {
        fail(new Error('print page failed'))
        return
      }
      finish()
      resolve({ fileName: event.data.fileName, html: event.data.html })
    }
    const onAbort = () => fail(signal.reason)
    // セッション切れでサインイン画面へ飛ばされたなど、印刷用ページが開けなかったときはタイムアウトを待たずに打ち切る
    // (サインイン画面は iframe への埋め込みを禁止しているので、エラーページになり中身を読めない)
    const onLoad = () => {
      let href: string | undefined
      try {
        href = frame.contentWindow?.location.href
      } catch {
        href = undefined
      }
      // 読み込み前の空の文書の load は待つ
      if (href === 'about:blank') {
        return
      }
      if (!href || !new URL(href).pathname.startsWith(PRINT_PATH_PREFIX)) {
        fail(new Error('print page not loaded'))
      }
    }
    const timer = setTimeout(() => fail(new Error('timeout')), FRAME_EXPORT_TIMEOUT)

    window.addEventListener('message', onMessage)
    signal.addEventListener('abort', onAbort)
    frame.addEventListener('load', onLoad)
    frame.src = path
    document.body.append(box)
  })

/**
 * 出力メニューの「HTML出力」。作った HTML をダウンロードし、作っている間は isPending を立てる。
 * - exportHtml: 印刷用ページ(`?format=html`)を見えない iframe で描いて HTML を受け取る。中身は印刷用ページの描画結果なので、別タブで開いて保存していたときと同じ
 * - exportWith: HTML を作る処理を渡す(設計書の HTML など)
 *
 * 作っている途中で画面を離れたら、iframe を消して保存もしない
 */
export const useHtmlExport = () => {
  const { t } = useLocale()
  const [isPending, setIsPending] = useState(false)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  const exportWith = async (render: (signal: AbortSignal) => Promise<{ fileName: string; html: string }>) => {
    const current = new AbortController()
    controller.current = current
    setIsPending(true)
    try {
      const { fileName, html } = await render(current.signal)
      if (!current.signal.aborted) {
        downloadHtml(fileName, html)
      }
    } catch {
      if (!current.signal.aborted) {
        notify.error(t('msg_save_html_failed'))
      }
    } finally {
      if (!current.signal.aborted) {
        setIsPending(false)
      }
    }
  }
  const exportHtml = (path: string) => exportWith((signal) => renderHtmlInFrame(path, signal))
  return { exportHtml, exportWith, isPending }
}

/** 印刷時は隠す操作欄。自動の印刷ダイアログを閉じた後に、開き直せるようにする */
export const PrintToolbar: FC = () => {
  const { t } = useLocale()
  return (
    <div className='mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-3 print:hidden'>
      <MultiButton size='sm' icon={<PrinterIcon width={16} />} onPress={() => window.print()}>
        {t('print_or_save_pdf')}
      </MultiButton>
      <span className='text-muted text-xs'>{t('msg_print_pdf_hint')}</span>
    </div>
  )
}
