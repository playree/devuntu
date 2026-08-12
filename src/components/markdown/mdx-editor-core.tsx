'use client'

import { uploadImage } from '@/lib/upload'
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
  InsertImage,
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
import { FC, useEffect, useMemo, useRef, useState } from 'react'
import { MentionCandidatesProvider, mentionPlugin } from './mdx-mention-plugin'
import { sanitizeHtmlPlugin } from './mdx-sanitize-plugin'
import { MentionCandidate } from './mention-menu'
import { MentionUsersProvider } from './mention-node'

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
    <InsertImage />
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
  /**
   * 挿入した画像の添付先ボード。配信時の可視判定に使われる。
   * 省略すると全ログインユーザーが参照できる添付になるので、ボードに属する本文では必ず渡すこと
   */
  uploadBoardId?: string | null
  /**
   * `@` 入力時に出すメンション候補。空 / 未指定なら候補は出ない。
   * ボードに属する本文では、そのボードのメンバー(担当者候補と同じ集合)を渡す
   */
  mentionCandidates?: MentionCandidate[]
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

/**
 * MDXEditor 本体。テーマが確定した後にだけマウントする。
 *
 * MDXEditor は `plugins` 配列が差し替わると内部の Lexical エディタを組み直すため、
 * 配列の参照はマウント後ずっと変えてはいけない(編集中の内容が失われる)。
 * `isDark` は初回の値で固定し、以降のテーマ切替では CodeMirror の拡張を変えない。
 * リッチテキスト面は className の `dark-theme` が追従するので見た目は破綻しない。
 */
const MdxEditorInner: FC<MdxEditorCoreProps & { isDark: boolean }> = ({
  markdown,
  onChange,
  onBlur,
  overlayContainer,
  uploadBoardId,
  mentionCandidates,
  placeholder,
  autoFocus,
  className,
  isDark,
}) => {
  // マウント時のテーマで固定する(編集中にテーマを切り替えても plugins を作り直さない)
  const [isDarkAtMount] = useState(isDark)

  /**
   * 添付先ボードは編集中に変わりうる(新規チケットモーダルのボード選択)。
   * plugins を作り直すと編集中の内容が失われるため、ハンドラの参照は固定したまま
   * ref 越しに最新値を読む。
   */
  const boardIdRef = useRef(uploadBoardId)
  useEffect(() => {
    boardIdRef.current = uploadBoardId
  }, [uploadBoardId])
  // useState の遅延初期化で初回マウント時の関数を固定する(ref を render 中に読まないため)
  const [uploadHandler] = useState(() => (file: File) => uploadImage(file, boardIdRef.current))

  const plugins = useMemo(() => {
    // source モードとコードブロックの CodeMirror は basicLight がハードコードされているため、
    // ダーク時は basicDark を渡して上書きする。カスタム拡張は拡張配列の先頭=高優先度で入り、
    // CodeMirror は高優先度の StyleModule を最後にマウントするので後勝ちで有効になる。
    const codeMirrorExtensions = isDarkAtMount ? [basicDark] : []
    return [
      // 危険な生HTMLはここで落とすため、編集して保存すると本文からも消える
      sanitizeHtmlPlugin(),
      headingsPlugin(),
      quotePlugin(),
      listsPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      thematicBreakPlugin(),
      tablePlugin(),
      /**
       * imageUploadHandler を渡すと、ツールバーの InsertImage に加えて
       * 貼り付け / ドラッグ&ドロップも imagePlugin 側が拾ってアップロードするようになる。
       * ハンドラは ref に固定した安定参照なので plugins は作り直されない
       */
      imagePlugin({ imageUploadHandler: uploadHandler }),
      // 候補は React context 経由で渡すため、引数に候補を取らず参照が固定される(mdx-mention-plugin.tsx)
      mentionPlugin({ typeahead: true }),
      codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
      codeMirrorPlugin({ codeBlockLanguages: CODE_BLOCK_LANGUAGES, codeMirrorExtensions }),
      markdownShortcutPlugin(),
      diffSourcePlugin({ viewMode: 'rich-text', codeMirrorExtensions }),
      toolbarPlugin({ toolbarContents: () => <Toolbar /> }),
    ]
    // uploadHandler は useState で固定した安定参照なので、依存に入れても plugins は作り直されない
  }, [isDarkAtMount, uploadHandler])

  return (
    <MentionCandidatesProvider candidates={mentionCandidates}>
      <MentionUsersProvider users={mentionCandidates}>
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
          // globals.css の .markdown を編集面にも効かせて表示側と見た目を揃える。
          // globals.css の `.mdxeditor .markdown` は最小行数(--mdx-min-rows)の適用先も兼ねる
          contentEditableClassName='markdown'
          toMarkdownOptions={TO_MARKDOWN_OPTIONS}
          plugins={plugins}
        />
      </MentionUsersProvider>
    </MentionCandidatesProvider>
  )
}

/**
 * MDXEditor の実体。ブラウザ専用なので `next/dynamic` の `ssr: false` 経由で読み込む前提。
 *
 * プラグインを親ファイルで静的 import すると SSR バンドルへ入ってしまうため、
 * MDXEditor 関連の import はすべてこのファイルに閉じ込めて default export する。
 * ツールバーに出さない構文(`---` / `![](url)`)のプラグインも、既存本文を
 * パースエラーにしないために読み込んでおく。
 *
 * `useTheme` の resolvedTheme は初回レンダーでは undefined なので、確定するまで
 * 本体をマウントしない。先にマウントすると確定直後に plugins が作り直されてしまう。
 */
const MdxEditorCore: FC<MdxEditorCoreProps> = (props) => {
  const { resolvedTheme } = useTheme()
  if (!resolvedTheme) {
    return null
  }
  return <MdxEditorInner {...props} isDark={resolvedTheme === 'dark'} />
}

export default MdxEditorCore
