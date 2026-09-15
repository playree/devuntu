'use client'

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { placeholder as cmPlaceholder, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { basicDark } from 'cm6-theme-basic-dark'
import { useTheme } from 'next-themes'
import { FC, useEffect, useRef } from 'react'

export type YamlEditorCoreProps = {
  /** 初回マウント時の内容。以後の変更は取り込まないので、外から入れ替えるときは key を変える */
  initialValue: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  /** 編集面の最小行数 */
  minRows?: number
}

/** 編集面の見た目。枠と角丸は呼び出し側の器に任せ、ここは中身の体裁だけを決める */
const baseTheme = EditorView.theme({
  '&': { fontSize: '0.8125rem' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', padding: '0.5rem 0' },
  '.cm-gutters': { border: 'none', background: 'transparent' },
  '.cm-scroller': { overflow: 'auto' },
})

/**
 * CodeMirror の実体。ブラウザ専用なので `next/dynamic` の `ssr: false` 経由で読み込む前提。
 *
 * 拡張は必要なものだけを並べる(`codemirror` の basicSetup は検索・補完・lint まで抱き込む)。
 * **Tab キーは束縛しない。** `indentWithTab` を入れるとモーダルの中でフォーカスが閉じ込められ、
 * キーボード操作で抜けられなくなる。YAML はタブ文字を許さないので、インデントは
 * `indentUnit` の半角スペース 2 つと、改行時の自動インデント(`defaultKeymap`)に任せる。
 */
const YamlEditorInner: FC<YamlEditorCoreProps & { isDark: boolean }> = ({
  initialValue,
  onChange,
  onBlur,
  placeholder,
  minRows = 12,
  isDark,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // 拡張の再構成でエディタを作り直さないよう、コールバックは ref 経由で最新を見る
  const handlers = useRef({ onChange, onBlur })
  useEffect(() => {
    handlers.current = { onChange, onBlur }
  }, [onChange, onBlur])

  useEffect(() => {
    const parent = hostRef.current
    if (!parent) {
      return
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          lineNumbers(),
          history(),
          yaml(),
          indentUnit.of('  '),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'YAML' }),
          ...(placeholder ? [cmPlaceholder(placeholder)] : []),
          baseTheme,
          // ダークは basicDark に任せ、ライトは CodeMirror 既定のハイライトを当てる
          ...(isDark ? [basicDark] : [syntaxHighlighting(defaultHighlightStyle, { fallback: true })]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              handlers.current.onChange(update.state.doc.toString())
            }
            if (update.focusChanged && !update.view.hasFocus) {
              handlers.current.onBlur?.()
            }
          }),
        ],
      }),
    })

    return () => {
      view.destroy()
    }
    // 内容は初回マウント時の値で固定する(入れ替えは呼び出し側の key で行う)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark])

  return <div ref={hostRef} style={{ minHeight: `calc(${minRows} * 1.4rem)` }} />
}

/**
 * `useTheme` の resolvedTheme は初回レンダーでは undefined なので、確定するまで本体をマウントしない。
 * 先にマウントすると、確定直後にテーマ差し替えでエディタが作り直されて入力位置が飛ぶ。
 */
const YamlEditorCore: FC<YamlEditorCoreProps> = (props) => {
  const { resolvedTheme } = useTheme()
  if (!resolvedTheme) {
    return null
  }
  return <YamlEditorInner {...props} isDark={resolvedTheme === 'dark'} />
}

export default YamlEditorCore
