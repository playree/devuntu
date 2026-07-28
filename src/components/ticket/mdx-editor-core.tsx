'use client'

import { cn } from '@heroui/react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeCodeMirrorLanguage,
  codeBlockPlugin,
  codeMirrorPlugin,
  CodeToggle,
  ConditionalContents,
  CreateLink,
  diffSourcePlugin,
  DiffSourceToggleWrapper,
  headingsPlugin,
  imagePlugin,
  InsertCodeBlock,
  InsertTable,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  Separator,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { basicDark } from 'cm6-theme-basic-dark'
import { useTheme } from 'next-themes'
import { FC, useMemo } from 'react'

/** コードブロックの言語選択に出す一覧(キーは Markdown のフェンス言語名) */
const CODE_BLOCK_LANGUAGES = {
  '': 'Text',
  ts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  json: 'JSON',
  sql: 'SQL',
  bash: 'Bash',
  css: 'CSS',
  html: 'HTML',
  md: 'Markdown',
}

/** rich-text と source のみ(diff は差分の元テキストを持たないため出さない) */
const VIEW_MODES = ['rich-text', 'source'] as const

/** シリアライズ時の記法を固定して、保存のたびに差分が出るのを防ぐ */
const TO_MARKDOWN_OPTIONS = { bullet: '-', listItemIndent: 'one' } as const

/** コードブロック非選択時に出す通常のリッチテキスト用コントロール */
const RichTextControls: FC = () => (
  <>
    <UndoRedo />
    <Separator />
    <BoldItalicUnderlineToggles />
    <CodeToggle />
    <Separator />
    <BlockTypeSelect />
    <ListsToggle />
    <Separator />
    <CreateLink />
    <InsertTable />
    <InsertCodeBlock />
  </>
)

/**
 * ツールバー。コードブロックにフォーカスがある間は CodeMirror で効かない
 * リッチテキスト用コントロールを隠し、言語セレクタだけを出す。
 * ビュー切替は常に使えるよう DiffSourceToggleWrapper は分岐の外に置く。
 */
const Toolbar: FC = () => (
  <DiffSourceToggleWrapper options={[...VIEW_MODES]}>
    <ConditionalContents
      options={[
        { when: (editor) => editor?.editorType === 'codeblock', contents: () => <ChangeCodeMirrorLanguage /> },
        { fallback: () => <RichTextControls /> },
      ]}
    />
  </DiffSourceToggleWrapper>
)

export type MdxEditorCoreProps = {
  /** 初期 Markdown。MDXEditor の仕様上、マウント後の変更は反映されない */
  markdown: string
  onChange: (markdown: string) => void
  onBlur?: () => void
  /** ポップアップの描画先。HeroUI Modal 内では Modal.Dialog を渡す */
  overlayContainer?: HTMLElement | null
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

/**
 * MDXEditor の実体。ブラウザ専用なので `next/dynamic` の `ssr: false` 経由で読み込む前提。
 *
 * プラグインを親ファイルで静的 import すると SSR バンドルへ入ってしまうため、
 * MDXEditor 関連の import はすべてこのファイルに閉じ込めて default export する。
 * ツールバーに出さない構文(`---` / `![](url)`)のプラグインも、既存本文を
 * パースエラーにしないために読み込んでおく。
 */
const MdxEditorCore: FC<MdxEditorCoreProps> = ({
  markdown,
  onChange,
  onBlur,
  overlayContainer,
  placeholder,
  autoFocus,
  className,
}) => {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  // source モードとコードブロックの CodeMirror は basicLight がハードコードされているため、
  // ダーク時は basicDark を渡して上書きする。カスタム拡張は拡張配列の先頭=高優先度で入り、
  // CodeMirror は高優先度の StyleModule を最後にマウントするので後勝ちで有効になる。
  const codeMirrorExtensions = useMemo(() => (isDark ? [basicDark] : []), [isDark])

  const plugins = useMemo(
    () => [
      headingsPlugin(),
      quotePlugin(),
      listsPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      thematicBreakPlugin(),
      tablePlugin(),
      imagePlugin(),
      codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
      codeMirrorPlugin({ codeBlockLanguages: CODE_BLOCK_LANGUAGES, codeMirrorExtensions }),
      markdownShortcutPlugin(),
      diffSourcePlugin({ viewMode: 'rich-text', codeMirrorExtensions }),
      toolbarPlugin({ toolbarContents: () => <Toolbar /> }),
    ],
    [codeMirrorExtensions],
  )

  return (
    <MDXEditor
      markdown={markdown}
      // 初期値の正規化による変更は無視する(編集していないのに dirty になるのを防ぐ)
      onChange={(value, initialMarkdownNormalize) => {
        if (!initialMarkdownNormalize) {
          onChange(value)
        }
      }}
      onBlur={onBlur ? () => onBlur() : undefined}
      overlayContainer={overlayContainer}
      placeholder={placeholder}
      autoFocus={autoFocus}
      // dark-theme が MDXEditor 公式のダーク切替。className の各語は
      // ポップアップ用コンテナにもコピーされるため、ドロップダウンとダイアログにも効く
      className={cn(isDark && 'dark-theme', className)}
      // globals.css の .markdown を編集面にも効かせて表示側と見た目を揃える
      contentEditableClassName='markdown'
      toMarkdownOptions={TO_MARKDOWN_OPTIONS}
      plugins={plugins}
    />
  )
}

export default MdxEditorCore
