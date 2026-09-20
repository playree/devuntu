import { lintGutter, linter } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { EditorView, tooltips } from '@codemirror/view'

/** CodeMirror に依存しない診断の形。検証する側は `@codemirror/lint` を知らなくてよい */
export type EditorIssue = {
  /** ドキュメント先頭からの文字オフセット */
  from: number
  to: number
  severity: 'error' | 'warning'
  message: string
}

/** 打鍵が止まってから検証するまで。既定の 750ms は書き直しの手が止まって感じられる */
const LINT_DELAY_MS = 400

/**
 * lint の体裁。色は CodeMirror 既定(赤 / 橙)に任せ、ここは日本語の文言が収まるようにだけ整える。
 * 吹き出しの地色はダークなら `basicDark` が `dark: true` を立てているので自動で暗くなる。
 */
const lintTheme = EditorView.theme({
  /**
   * 吹き出しの地色は自前で決める。CodeMirror の既定は `&dark`(= エディタ本体に付く印)で切り替わるが、
   * `body` へ出した吹き出しはその内側に無いので、どちらの印も当たらず地色が抜ける。
   * アプリの CSS 変数を使えば、テーマの切り替えは変数側が面倒を見てくれる。
   */
  '.cm-tooltip': {
    // 既定の 500 では HeroUI のモーダル(backdrop が 100000)の下へ潜って見えない
    zIndex: '100010',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    border: '1px solid var(--default)',
    borderRadius: '0.375rem',
    boxShadow: '0 4px 12px rgb(0 0 0 / 0.25)',
  },
  '.cm-tooltip-lint': { maxWidth: 'min(90vw, 32rem)' },
  '.cm-diagnostic': { fontSize: '0.75rem', lineHeight: '1.4' },
  '.cm-gutter-lint': { width: '1.1em' },
})

/**
 * 入力内容の検証をエディタへ組み込む。
 *
 * 検証関数は**呼び出しのたびに読み直す**(`getLint`)。拡張を作り直すとエディタごと作り直しになり、
 * 内容が初期値へ巻き戻るため、親の再レンダーに追随させる口はここにしか作れない。
 *
 * 吹き出しは `body` 直下へ出す。エディタの器は角丸のために `overflow: hidden` を掛けており、
 * 既定の置き場所(エディタの内側)だと上下端の吹き出しが切れて読めない。
 */
export const yamlLint = (getLint: () => ((value: string) => EditorIssue[]) | undefined): Extension[] => [
  linter((view) => getLint()?.(view.state.doc.toString()) ?? [], { delay: LINT_DELAY_MS }),
  lintGutter(),
  tooltips({ position: 'fixed', parent: document.body }),
  lintTheme,
]
