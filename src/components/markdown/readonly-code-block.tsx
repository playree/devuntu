'use client'

import { FC, useEffect, useState } from 'react'
import type { HighlightedToken } from './code-highlight'

type Highlighted = { code: string; language: string; tokens: HighlightedToken[] | undefined }

/**
 * 表示用のフェンスドコード。言語の指定があれば色付けする。
 *
 * 色付けの処理(CodeMirror の言語定義とパーサー)は言語付きのブロックがあるときだけ読み込む。
 * 読み込むまでは素のコードを出し、印刷用ページが待てるよう目印を付けておく(useWhenRendered)。
 * 対応していない言語や失敗したときは素のコードのまま。
 */
export const ReadOnlyCodeBlock: FC<{ code: string; language?: string }> = ({ code, language }) => {
  const [highlighted, setHighlighted] = useState<Highlighted>()

  useEffect(() => {
    if (!language) {
      return
    }
    let cancelled = false
    import('./code-highlight')
      .then(({ highlight }) => highlight(code, language))
      .catch(() => undefined)
      .then((tokens) => {
        if (!cancelled) {
          setHighlighted({ code, language, tokens })
        }
      })
    return () => {
      cancelled = true
    }
  }, [code, language])

  const current = highlighted?.code === code && highlighted.language === language ? highlighted : undefined
  const isLoading = !!language && !current

  return (
    <pre className={language ? `language-${language}` : undefined} data-markdown-loading={isLoading || undefined}>
      <code>
        {current?.tokens
          ? current.tokens.map((token, i) =>
              token.className ? (
                <span key={i} className={token.className}>
                  {token.text}
                </span>
              ) : (
                token.text
              ),
            )
          : code}
      </code>
    </pre>
  )
}
