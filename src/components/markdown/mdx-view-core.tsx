'use client'

import { cn } from '@heroui/react'
import {
  codeBlockPlugin,
  headingsPlugin,
  imagePlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { useTheme } from 'next-themes'
import { FC, MouseEvent, useMemo } from 'react'
import { sanitizeHtmlPlugin } from './mdx-sanitize-plugin'
import { readOnlyCodeBlockDescriptor, readOnlyTablePlugin } from './mdx-view-plugins'

export type MdxViewCoreProps = {
  markdown: string
  /** パースに失敗したときに呼ばれる。MDXEditor は例外を投げず空の本文になるため、呼び元で代替表示に切り替える */
  onError: () => void
}

/**
 * リンクを新規タブで開く。
 *
 * `linkPlugin` は `LinkNode` に target を持たせないため、素の `<a>` として
 * 同一タブ遷移になる。href は Lexical の `sanitizeUrl` を通っており
 * `javascript:` / `data:` は `about:blank` に落ちているのでそのまま開いてよい。
 */
const openLinkInNewTab = (e: MouseEvent<HTMLDivElement>) => {
  const target = e.target
  if (!(target instanceof Element)) {
    return
  }
  const anchor = target.closest('a[href]')
  if (anchor instanceof HTMLAnchorElement && !anchor.target) {
    e.preventDefault()
    window.open(anchor.href, '_blank', 'noopener,noreferrer')
  }
}

/**
 * Markdown 表示の実体。ブラウザ専用なので `next/dynamic` の `ssr: false` 経由で読み込む前提。
 *
 * 編集面と同じ MDXEditor で描画して、書いた見た目と表示を一致させる。
 * 編集用の {@link ./mdx-editor-core} とはファイルを分けてあり、ツールバー・source 切替・
 * CodeMirror を含まないぶん表示だけの画面では読み込むチャンクが小さくなる。
 */
const MdxViewCore: FC<MdxViewCoreProps> = ({ markdown, onError }) => {
  const { resolvedTheme } = useTheme()

  const plugins = useMemo(
    () => [
      sanitizeHtmlPlugin(),
      headingsPlugin(),
      quotePlugin(),
      listsPlugin(),
      linkPlugin(),
      thematicBreakPlugin(),
      // gfm の表構文をパースするために必要。描画は readOnlyTablePlugin が引き取る
      tablePlugin(),
      readOnlyTablePlugin(),
      // readOnly でも click は届くため、画像の選択枠とリサイズハンドルは明示的に止める
      imagePlugin({ disableImageResize: true, disableImageSettingsButton: true, ImageDialog: () => null }),
      codeBlockPlugin({ codeBlockEditorDescriptors: [readOnlyCodeBlockDescriptor] }),
    ],
    [],
  )

  if (!resolvedTheme) {
    return null
  }
  return (
    <div onClickCapture={openLinkInNewTab}>
      <MDXEditor
        readOnly
        spellCheck={false}
        markdown={markdown}
        onError={onError}
        className={cn('mdxeditor-view', resolvedTheme === 'dark' && 'dark-theme')}
        contentEditableClassName='markdown'
        plugins={plugins}
      />
    </div>
  )
}

export default MdxViewCore
