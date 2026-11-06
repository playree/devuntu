'use client'

import { useResolvedTheme } from '@/lib/use-resolved-theme'
import { useLocale } from '@/locale/client'
import { Skeleton } from '@heroui/react'
import { FC, useEffect, useId, useState } from 'react'

type Rendered = { code: string; isDark: boolean } & ({ svg: string } | { error: string })

/** mermaid は設定(initialize)がグローバルなので、テーマの違う描画が混ざらないよう1つずつ描く */
let renderQueue: Promise<unknown> = Promise.resolve()

const queueRender = <T,>(render: () => Promise<T>): Promise<T> => {
  const result = renderQueue.then(render)
  renderQueue = result.catch(() => undefined)
  return result
}

const renderDiagram = (id: string, code: string, isDark: boolean): Promise<string> =>
  queueRender(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      // ラベル中の HTML を無害化し、クリックイベントなどのスクリプトを無効にする
      securityLevel: 'strict',
      theme: isDark ? 'dark' : 'default',
      fontFamily: getComputedStyle(document.body).fontFamily,
    })
    try {
      return (await mermaid.render(id, code)).svg
    } catch (e) {
      // 失敗すると描画用の一時要素が body に残る
      document.getElementById(`d${id}`)?.remove()
      throw e
    }
  })

/**
 * mermaid のフェンスドコードを図として描画する。
 *
 * mermaid 本体は大きいので、このブロックがあるときだけ読み込む。
 * 描画が終わるまでは印刷用ページが待てるよう目印付きの枠を出す(useWhenRendered)。
 * 書き間違いなどで描画できないときは、エラーと元のコードを出す。
 */
export const MermaidDiagram: FC<{ code: string }> = ({ code }) => {
  const { t } = useLocale()
  const isDark = useResolvedTheme() === 'dark'
  // useId の `:` / `«` は mermaid が要素の id とセレクタに使うため取り除く
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [rendered, setRendered] = useState<Rendered>()

  useEffect(() => {
    let cancelled = false
    renderDiagram(id, code, isDark)
      .then(
        (svg): Rendered => ({ code, isDark, svg }),
        (e: unknown): Rendered => ({ code, isDark, error: e instanceof Error ? e.message : String(e) }),
      )
      .then((result) => {
        if (!cancelled) {
          setRendered(result)
        }
      })
    return () => {
      cancelled = true
    }
  }, [id, code, isDark])

  const current = rendered?.code === code && rendered.isDark === isDark ? rendered : undefined
  if (!current) {
    return <Skeleton data-markdown-loading className='my-2 h-32 w-full rounded-lg' />
  }
  if ('error' in current) {
    return (
      <div className='my-2'>
        <p className='text-danger text-sm'>{t('msg_mermaid_render_failed')}</p>
        <p className='text-muted mb-1 text-xs wrap-break-word whitespace-pre-wrap'>{current.error}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    )
  }
  return (
    <div
      /**
       * SVG は securityLevel: 'strict' の mermaid が DOMPurify で無害化済み。
       * 本文の `%%{init}%%` からは securityLevel を変えられない(mermaid の secure 設定)
       */
      className='markdown-mermaid'
      dangerouslySetInnerHTML={{ __html: current.svg }}
    />
  )
}
