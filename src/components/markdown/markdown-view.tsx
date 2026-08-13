'use client'

import { cn, Skeleton } from '@heroui/react'
import dynamic from 'next/dynamic'
import { memo, useCallback, useState } from 'react'
import { ErrorBoundary } from '../general/error-boundary'
import { MentionUser } from './mention-node'

// MDXEditor はブラウザ専用なので SSR から外す(lexical も別チャンクへ分離される)
const MdxViewCore = dynamic(() => import('./mdx-view-core'), {
  ssr: false,
  loading: () => <Skeleton className='h-6 w-full rounded-lg' />,
})

/**
 * チケット本文 / コメント / お知らせなどの Markdown 表示。
 *
 * 編集と同じ MDXEditor で描画するため、書いた見た目とそのまま一致する。
 * 生HTMLの無害化は `mdx-sanitize-plugin` が表示・編集の両方で行う。
 * スタイルは src/app/globals.css の `.markdown` を利用する。
 */
export const MarkdownView = memo<{
  body: string
  className?: string
  /** 本文中のメンションを `@表示名` で出すためのユーザー(そのボードのメンバー) */
  mentionUsers?: MentionUser[]
}>(function MarkdownView({ body, className, mentionUsers }) {
  // MDXEditor はパースに失敗しても例外を投げず本文が空になるだけなので、素のテキストに切り替える
  const [failedBody, setFailedBody] = useState<string>()
  // onError は MDXEditor の初期化中(=別コンポーネントのレンダー中)に呼ばれうる
  const onError = useCallback(() => queueMicrotask(() => setFailedBody(body)), [body])

  const plainText = <pre className='font-mono text-sm wrap-break-word whitespace-pre-wrap'>{body}</pre>

  return (
    <div className={cn('text-foreground wrap-break-word', className)}>
      {failedBody === body ? (
        plainText
      ) : (
        <ErrorBoundary resetKey={body} fallback={plainText}>
          <MdxViewCore markdown={body} onError={onError} mentionUsers={mentionUsers} />
        </ErrorBoundary>
      )}
    </div>
  )
})
