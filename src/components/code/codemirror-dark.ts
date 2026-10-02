import { EditorView } from '@codemirror/view'
import { basicDark } from 'cm6-theme-basic-dark'

/**
 * basicDark の選択色の補正。
 *
 * basicDark の選択色(#202325)は地色(#2E3235)より暗い。さらにフォーカス中は
 * `@codemirror/view` の baseTheme(`&dark.cm-focused > .cm-scroller > .cm-selectionLayer ...` の #233)が
 * 特異性で勝つため、選択範囲がほぼ見えず、同じ文字列の一致箇所(selectionMatch)のほうが目立ってしまう。
 */
const selectionTheme = EditorView.theme(
  {
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: '#3b5578' },
    '.cm-selectionMatch': { backgroundColor: '#ffffff14' },
  },
  { dark: true },
)

/** ダーク表示の CodeMirror に渡す拡張 */
export const codeMirrorDark = [selectionTheme, basicDark]
