'use client'

import { FC, useEffect, useState } from 'react'
import type { HighlightedToken } from './code-highlight'

/**
 * 色付けする最大文字数。パースと token ごとの span の生成はメインスレッドで一度に行うため、
 * 長いログなどを貼った本文で画面が固まらないよう、超えたら素のコードのまま出す
 */
const HIGHLIGHT_MAX_LENGTH = 50_000

type Highlighted = { code: string; language: string; tokens: HighlightedToken[] | undefined }

/**
 * 表示用のフェンスドコード。言語の指定があれば色付けする。
 *
 * 色付けの処理(CodeMirror の言語定義とパーサー)は言語付きのブロックがあるときだけ読み込む。
 * 読み込むまでは素のコードを出し、印刷用ページが待てるよう目印を付けておく(useWhenRendered)。
 * 対応していない言語・長すぎるコード・失敗したときは素のコードのまま。
 */
export const ReadOnlyCodeBlock: FC<{ code: string; language?: string }> = ({ code, language }) => {
  const [highlighted, setHighlighted] = useState<Highlighted>()
  const shouldHighlight = !!language && code.length <= HIGHLIGHT_MAX_LENGTH

  useEffect(() => {
    if (!language || !shouldHighlight) {
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
  }, [code, language, shouldHighlight])

  const current = highlighted?.code === code && highlighted.language === language ? highlighted : undefined
  const isLoading = shouldHighlight && !current

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
