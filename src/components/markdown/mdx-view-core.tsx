'use client'

import { cn } from '@heroui/react'
import {
  codeBlockPlugin,
  headingsPlugin,
  imagePlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  MDXEditorMethods,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { useTheme } from 'next-themes'
import { FC, MouseEvent, useEffect, useMemo, useRef } from 'react'
import { useModalState } from '../general/modal'
import { findLightboxImage, ImageLightbox, LightboxImage } from './image-lightbox'
import { mentionPlugin } from './mdx-mention-plugin'
import { sanitizeHtmlPlugin } from './mdx-sanitize-plugin'
import { readOnlyCodeBlockDescriptor, readOnlyTablePlugin } from './mdx-view-plugins'
import { MentionUser, MentionUsersProvider } from './mention-node'

export type MdxViewCoreProps = {
  markdown: string
  /** パースに失敗したときに呼ばれる。MDXEditor は例外を投げず空の本文になるため、呼び元で代替表示に切り替える */
  onError: () => void
  /** 本文中のメンションを `@表示名` で出すためのユーザー。渡さないとメールアドレスのまま表示される */
  mentionUsers?: MentionUser[]
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
const MdxViewCore: FC<MdxViewCoreProps> = ({ markdown, onError, mentionUsers }) => {
  const { resolvedTheme } = useTheme()
  const editorRef = useRef<MDXEditorMethods>(null)
  /**
   * 反映済みの Markdown。マウント時は `markdown` prop から取り込まれるため初期値に入れておく。
   * MDXEditor 側の値は正規化されていて prop と一致しないので、比較には prop の生の値を使う
   */
  const appliedRef = useRef(markdown)
  const lightbox = useModalState<LightboxImage>()

  /**
   * リンク遷移を優先し、それ以外の画像クリックでライトボックスを開く。
   *
   * `[![alt](img)](url)` は LinkNode の中に ImageNode が入るため、`openLinkInNewTab` が
   * `preventDefault` を済ませていれば拡大は行わない。
   * 画像は Lexical の DecoratorNode(portal)だが、合成イベントは React ツリーを遡るのでここに届く。
   */
  const onContentClick = (e: MouseEvent<HTMLDivElement>) => {
    openLinkInNewTab(e)
    if (e.defaultPrevented) {
      return
    }
    const image = findLightboxImage(e)
    if (image) {
      lightbox.open(image)
    }
  }

  // MDXEditor は markdown prop の変更を取り込まないため、明示的に差し替える
  useEffect(() => {
    if (appliedRef.current !== markdown) {
      appliedRef.current = markdown
      editorRef.current?.setMarkdown(markdown)
    }
  }, [markdown])

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
      // 表示専用なので候補の入力補助は付けない(記法の解釈と描画だけ)
      mentionPlugin(),
    ],
    [],
  )

  if (!resolvedTheme) {
    return null
  }
  return (
    <div onClickCapture={onContentClick}>
      <MentionUsersProvider users={mentionUsers}>
        <MDXEditor
          ref={editorRef}
          readOnly
          spellCheck={false}
          markdown={markdown}
          onError={onError}
          className={cn('mdxeditor-view', resolvedTheme === 'dark' && 'dark-theme')}
          contentEditableClassName='markdown'
          plugins={plugins}
        />
      </MentionUsersProvider>
      <ImageLightbox key={lightbox.key} state={lightbox} image={lightbox.target} />
    </div>
  )
}

export default MdxViewCore
