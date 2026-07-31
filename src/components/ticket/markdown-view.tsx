'use client'

import { cn } from '@heroui/react'
import { FC } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

/**
 * 生HTMLの許可リスト。GitHub 準拠の `defaultSchema` に `u` だけを追加する。
 *
 * MDXEditor の下線は Markdown に標準記法が無く `<u>text</u>` として保存されるため、
 * 許可しないと表示側でタグ文字列のまま見えてしまう(編集モードとの表示差異になる)。
 */
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u'],
}

/**
 * チケット本文 / コメントの Markdown 表示。
 *
 * 生HTMLは `rehype-raw` で要素化したうえで `rehype-sanitize` の許可リストで無害化する。
 * プラグインの順序は raw → sanitize が必須(逆にすると無害化を通り抜けて XSS になる)。
 * 外部リンクは新規タブで開き、rel を付与する。
 * スタイルは src/app/globals.css の `.markdown` を利用する。
 */
export const MarkdownView: FC<{ body: string; className?: string }> = ({ body, className }) => (
  <div className={cn('markdown text-foreground break-words', className)}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}
      components={{
        // node は react-markdown が渡す hast ノード。DOM 属性ではないので除外する
        a: ({ href, children, node: _node, ...props }) => (
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
