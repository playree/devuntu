'use client'

import { cn } from '@heroui/react'
import { FC } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * チケット本文 / コメントの Markdown 表示。
 *
 * `rehype-raw` は入れない(生HTMLを無効のまま維持して XSS を防ぐ)。
 * 外部リンクは新規タブで開き、rel を付与する。
 * スタイルは src/app/globals.css の `.markdown` を利用する。
 */
export const MarkdownView: FC<{ body: string; className?: string }> = ({ body, className }) => (
  <div className={cn('markdown text-foreground break-words', className)}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, ...props }) => (
          <a href={href} target='_blank' rel='noopener noreferrer' {...props}>
            {children}
          </a>
        ),
      }}
    >
      {body}
    </ReactMarkdown>
  </div>
)
