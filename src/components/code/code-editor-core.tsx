'use client'

import { useResolvedTheme } from '@/lib/use-resolved-theme'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { Compartment, EditorSelection, EditorState, Extension } from '@codemirror/state'
import { placeholder as cmPlaceholder, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { FC, RefObject, useEffect, useImperativeHandle, useRef } from 'react'
import { codeMirrorDark } from './codemirror-dark'

/** 外からエディタを操作する口 */
export type CodeEditorHandle = {
  /** その行(0 始まり)へカーソルを置き、見える位置へスクロールしてフォーカスする */
  revealLine: (line: number) => void
  /** 選択範囲をテキストで置き換える(無ければカーソル位置へ挿入する) */
  insertText: (text: string) => void
}

export type CodeEditorCoreProps = {
  /** 初回マウント時の内容。以後の変更は取り込まないので、外から入れ替えるときは key を変える */
  initialValue: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  /** 編集面の最小行数 */
  minRows?: number
  /** 編集面の読み上げ名 */
  'aria-label': string
  /**
   * 言語の拡張。関数を渡すと読み込んでから差し込む(大きな言語定義を別チャンクにするため)。
   * **初回マウント時に決まる**
   */
  language?: Extension | (() => Promise<Extension>)
  /** 追加の拡張を作る。**初回マウント時に一度だけ呼ぶ**(差し替えると内容が巻き戻るため) */
  extensions?: () => Extension
  /** カーソルのある行(0 始まり)が変わったとき */
  onCursorLine?: (line: number) => void
  /** ファイルが貼り付け・ドロップされたとき。true を返すと引き取ったとみなし、エディタには入れない */
  onFiles?: (files: File[]) => boolean
  /** 親の高さいっぱいに広げ、中でスクロールする(minRows は効かない) */
  isFill?: boolean
  editorRef?: RefObject<CodeEditorHandle | null>
}

/** 編集面の見た目。枠と角丸は呼び出し側の器に任せ、ここは中身の体裁だけを決める */
const baseTheme = EditorView.theme({
  '&': { fontSize: '0.8125rem' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', padding: '0.5rem 0' },
  '.cm-gutters': { border: 'none', background: 'transparent' },
  '.cm-scroller': { overflow: 'auto' },
})

const fillTheme = EditorView.theme({ '&': { height: '100%' } })

/** ダークは basicDark(選択色の補正込み)に任せ、ライトは CodeMirror 既定のハイライトを当てる */
const colorTheme = (isDark: boolean): Extension =>
  isDark ? codeMirrorDark : syntaxHighlighting(defaultHighlightStyle, { fallback: true })

const filesOf = (data: DataTransfer | null): File[] => (data ? Array.from(data.files) : [])

/**
 * CodeMirror の実体。ブラウザ専用なので `next/dynamic` の `ssr: false` 経由で読み込む前提。
 *
 * 拡張は必要なものだけを並べる(`codemirror` の basicSetup は検索・補完まで抱き込む)。
 * **Tab キーは束縛しない。** `indentWithTab` を入れるとモーダルの中でフォーカスが閉じ込められ、
 * キーボード操作で抜けられなくなる。インデントは `indentUnit` の半角スペース 2 つと、
 * 改行時の自動インデント(`defaultKeymap`)に任せる。
 */
const CodeEditorInner: FC<CodeEditorCoreProps & { isDark: boolean }> = ({
  initialValue,
  onChange,
  onBlur,
  placeholder,
  minRows = 12,
  'aria-label': ariaLabel,
  language,
  extensions,
  onCursorLine,
  onFiles,
  isFill,
  editorRef,
  isDark,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 色と言語だけを後から差し替えるための仕切り
  const themeRef = useRef(new Compartment())
  const languageRef = useRef(new Compartment())
  // 生成時に読む値。依存に入れるとテーマの切り替えでエディタを作り直すことになる
  const isDarkRef = useRef(isDark)
  // 拡張の再構成でエディタを作り直さないよう、コールバックは ref 経由で最新を見る
  const handlers = useRef({ onChange, onBlur, onCursorLine, onFiles })
  useEffect(() => {
    handlers.current = { onChange, onBlur, onCursorLine, onFiles }
  }, [onChange, onBlur, onCursorLine, onFiles])

  useImperativeHandle(editorRef, () => ({
    revealLine: (line) => {
      const view = viewRef.current
      if (!view) {
        return
      }
      const { from } = view.state.doc.line(Math.min(Math.max(line + 1, 1), view.state.doc.lines))
      view.dispatch({
        selection: EditorSelection.cursor(from),
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
      })
      view.focus()
    },
    insertText: (text) => {
      const view = viewRef.current
      if (!view) {
        return
      }
      view.dispatch(view.state.replaceSelection(text))
      view.focus()
    },
  }))

  useEffect(() => {
    const parent = hostRef.current
    if (!parent) {
      return
    }

    // 呼び出し側が引き取った貼り付け・ドロップのファイルは、エディタに入れない
    const takeFiles = (files: File[], event: Event) => {
      if (files.length === 0 || !handlers.current.onFiles?.(files)) {
        return false
      }
      event.preventDefault()
      return true
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          lineNumbers(),
          history(),
          languageRef.current.of(typeof language === 'function' ? [] : (language ?? [])),
          indentUnit.of('  '),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
          ...(placeholder ? [cmPlaceholder(placeholder)] : []),
          extensions?.() ?? [],
          baseTheme,
          isFill ? fillTheme : [],
          themeRef.current.of(colorTheme(isDarkRef.current)),
          EditorView.domEventHandlers({
            paste: (event) => takeFiles(filesOf(event.clipboardData), event),
            drop: (event) => takeFiles(filesOf(event.dataTransfer), event),
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              handlers.current.onChange(update.state.doc.toString())
            }
            if (update.focusChanged && !update.view.hasFocus) {
              handlers.current.onBlur?.()
            }
            if (update.docChanged || update.selectionSet) {
              const line = update.state.doc.lineAt(update.state.selection.main.head).number - 1
              const before = update.startState.doc.lineAt(update.startState.selection.main.head).number - 1
              if (line !== before || update.docChanged) {
                handlers.current.onCursorLine?.(line)
              }
            }
          }),
        ],
      }),
    })
    viewRef.current = view

    let disposed = false
    if (typeof language === 'function') {
      void language().then((loaded) => {
        if (!disposed) {
          view.dispatch({ effects: languageRef.current.reconfigure(loaded) })
        }
      })
    }

    return () => {
      disposed = true
      view.destroy()
      viewRef.current = null
    }
    // 内容と拡張は初回マウント時の値で固定する(入れ替えは呼び出し側の key で行う)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * テーマは色の拡張だけを入れ替える。作り直すと文書が `initialValue` へ巻き戻り、
   * 親が持つ編集後の値と食い違ったまま保存できてしまう。
   */
  useEffect(() => {
    isDarkRef.current = isDark
    viewRef.current?.dispatch({ effects: themeRef.current.reconfigure(colorTheme(isDark)) })
  }, [isDark])

  return (
    <div
      ref={hostRef}
      className={isFill ? 'h-full min-h-0' : undefined}
      style={isFill ? undefined : { minHeight: `calc(${minRows} * 1.4rem)` }}
    />
  )
}

/**
 * テーマ(useResolvedTheme)は初回レンダーでは undefined なので、確定するまで本体をマウントしない。
 * 先にマウントすると、ダークの利用者に一瞬ライトの編集面が見える。
 */
export const CodeEditorCore: FC<CodeEditorCoreProps> = (props) => {
  const resolvedTheme = useResolvedTheme()
  if (!resolvedTheme) {
    return null
  }
  return <CodeEditorInner {...props} isDark={resolvedTheme === 'dark'} />
}
