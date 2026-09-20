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
import { Compartment, EditorState, Extension } from '@codemirror/state'
import { placeholder as cmPlaceholder, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { basicDark } from 'cm6-theme-basic-dark'
import { useTheme } from 'next-themes'
import { FC, useEffect, useRef } from 'react'
import { yamlLint, type EditorIssue } from './yaml-lint'

export type YamlEditorCoreProps = {
  /** 初回マウント時の内容。以後の変更は取り込まないので、外から入れ替えるときは key を変える */
  initialValue: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  /** 編集面の最小行数 */
  minRows?: number
  /**
   * 内容から指摘を作る。渡すと該当箇所へ印が付く。
   *
   * 組み込むかどうかは**初回マウント時に決まる**(拡張を差し替えると内容が巻き戻るため)。
   * 関数そのものは毎回読み直すので、後から中身が変わるぶんには追随する。
   */
  lint?: (value: string) => EditorIssue[]
}

/** 編集面の見た目。枠と角丸は呼び出し側の器に任せ、ここは中身の体裁だけを決める */
const baseTheme = EditorView.theme({
  '&': { fontSize: '0.8125rem' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', padding: '0.5rem 0' },
  '.cm-gutters': { border: 'none', background: 'transparent' },
  '.cm-scroller': { overflow: 'auto' },
})

/** ダークは basicDark に任せ、ライトは CodeMirror 既定のハイライトを当てる */
const colorTheme = (isDark: boolean): Extension =>
  isDark ? basicDark : syntaxHighlighting(defaultHighlightStyle, { fallback: true })

/**
 * CodeMirror の実体。ブラウザ専用なので `next/dynamic` の `ssr: false` 経由で読み込む前提。
 *
 * 拡張は必要なものだけを並べる(`codemirror` の basicSetup は検索・補完まで抱き込む)。
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
  lint,
  isDark,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 色だけを後から差し替えるための仕切り
  const themeRef = useRef(new Compartment())
  // 生成時に読む値。依存に入れるとテーマの切り替えでエディタを作り直すことになる
  const isDarkRef = useRef(isDark)
  // 拡張の再構成でエディタを作り直さないよう、コールバックは ref 経由で最新を見る
  const handlers = useRef({ onChange, onBlur, lint })
  useEffect(() => {
    handlers.current = { onChange, onBlur, lint }
  }, [onChange, onBlur, lint])

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
          ...(lint ? yamlLint(() => handlers.current.lint) : []),
          baseTheme,
          themeRef.current.of(colorTheme(isDarkRef.current)),
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
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 内容は初回マウント時の値で固定する(入れ替えは呼び出し側の key で行う)
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

  return <div ref={hostRef} style={{ minHeight: `calc(${minRows} * 1.4rem)` }} />
}

/**
 * `useTheme` の resolvedTheme は初回レンダーでは undefined なので、確定するまで本体をマウントしない。
 * 先にマウントすると、ダークの利用者に一瞬ライトの編集面が見える。
 */
const YamlEditorCore: FC<YamlEditorCoreProps> = (props) => {
  const { resolvedTheme } = useTheme()
  if (!resolvedTheme) {
    return null
  }
  return <YamlEditorInner {...props} isDark={resolvedTheme === 'dark'} />
}

export default YamlEditorCore
