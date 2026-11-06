import { AlertType, parseAlertMarker } from '@/lib/markdown-alert'
import {
  $createGenericHTMLNode,
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  CodeBlockEditorDescriptor,
  LexicalExportVisitor,
  MdastImportVisitor,
  realmPlugin,
} from '@mdxeditor/editor'
import { ElementNode } from 'lexical'
import { $createAlertTitleNode, $isAlertTitleNode, AlertTitleNode } from './alert-nodes'
import { MdastNode } from './mdast-types'
import { MermaidDiagram } from './mermaid-diagram'
import { ReadOnlyCodeBlock } from './readonly-code-block'

type MdastBlockquote = Extract<MdastNode, { type: 'blockquote' }>
type MdastTable = Extract<MdastNode, { type: 'table' }>
type MdastTableRow = Extract<MdastNode, { type: 'tableRow' }>
type MdastTableCell = Extract<MdastNode, { type: 'tableCell' }>
type MdxJsxAttribute = Parameters<typeof $createGenericHTMLNode>[2][number]

/**
 * フェンスドコードを `<pre><code>` として描画する catch-all。
 *
 * `codeBlockPlugin` は該当する descriptor が無いと `code` ノードで
 * パースエラーになるため、表示専用でも 1 つは登録する必要がある。
 * これを渡すことで `codeMirrorPlugin` を外し、CodeMirror 一式を
 * 表示側のチャンクから切り離せる。
 */
export const readOnlyCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 0,
  match: () => true,
  Editor: ({ code, language }) => <ReadOnlyCodeBlock code={code} language={language} />,
}

/** ` ```mermaid ` を図として描画する。{@link readOnlyCodeBlockDescriptor} より先に照合させる */
export const mermaidCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 1,
  match: (language) => language === 'mermaid',
  Editor: ({ code }) => <MermaidDiagram code={code} />,
}

const $htmlNode = (tag: string, style?: string) => {
  const attributes: MdxJsxAttribute[] = style ? [{ type: 'mdxJsxAttribute', name: 'style', value: style }] : []
  return $createGenericHTMLNode(tag, 'mdxJsxFlowElement', attributes)
}

/** 見出し行かどうかと列揃えを table visitor から cell visitor へ引き渡す */
const rowInfo = new WeakMap<object, { isHeader: boolean; align: MdastTable['align'] }>()

const tableVisitor: MdastImportVisitor<MdastTable> = {
  priority: 1,
  testNode: 'table',
  visitNode({ mdastNode, actions }) {
    mdastNode.children.forEach((row, index) => {
      rowInfo.set(row, { isHeader: index === 0, align: mdastNode.align })
    })
    actions.addAndStepInto($htmlNode('table'))
  },
}

const tableRowVisitor: MdastImportVisitor<MdastTableRow> = {
  priority: 1,
  testNode: 'tableRow',
  visitNode({ actions }) {
    actions.addAndStepInto($htmlNode('tr'))
  },
}

const tableCellVisitor: MdastImportVisitor<MdastTableCell> = {
  priority: 1,
  testNode: 'tableCell',
  visitNode({ mdastNode, mdastParent, actions }) {
    const info = mdastParent ? rowInfo.get(mdastParent) : undefined
    const align = mdastParent ? info?.align?.[mdastParent.children.indexOf(mdastNode)] : undefined
    actions.addAndStepInto($htmlNode(info?.isHeader ? 'th' : 'td', align ? `text-align:${align}` : undefined))
  },
}

/**
 * 表を素の HTML 要素として描画する。
 *
 * `tablePlugin` の `TableEditor` はセルごとに独立した Lexical エディタを
 * `editable: true` で生成するため、`readOnly` を渡してもセルに文字が打ててしまう。
 * gfm の表構文をパースするには `tablePlugin` 自体が必要なので、外すのではなく
 * 標準 visitor(priority 0)より高い優先度で上書きする。
 */
export const readOnlyTablePlugin = realmPlugin({
  init: (realm) => {
    realm.pub(addImportVisitor$, [tableVisitor, tableRowVisitor, tableCellVisitor])
  },
})

/**
 * 引用の子から注意書きの目印を取り除いたものを返す。注意書きでなければ undefined。
 * 目印だけの段落は落とす。元の mdast は書き換えない
 */
const stripAlertMarker = (
  children: MdastBlockquote['children'],
): { type: AlertType; children: MdastBlockquote['children'] } | undefined => {
  const [first, ...others] = children
  if (first?.type !== 'paragraph') {
    return undefined
  }
  const [text, ...inlines] = first.children
  const marker = text?.type === 'text' ? parseAlertMarker(text.value) : undefined
  if (!marker) {
    return undefined
  }
  const restInlines = marker.rest ? [{ ...text, value: marker.rest }, ...inlines] : inlines
  const rest = restInlines.length > 0 ? [{ ...first, children: restInlines }, ...others] : others
  // GitHub と同じく、目印しか無い引用は注意書きにしない
  return rest.length > 0 ? { type: marker.type, children: rest } : undefined
}

const alertVisitor: MdastImportVisitor<MdastBlockquote> = {
  priority: 1,
  testNode: 'blockquote',
  visitNode({ mdastNode, mdastParent, lexicalParent, actions }) {
    // GitHub と同じく、リストや引用の中に書いたものは普通の引用のままにする
    const alert = mdastParent?.type === 'root' ? stripAlertMarker(mdastNode.children) : undefined
    if (!alert) {
      actions.nextVisitor()
      return
    }
    const container = $createGenericHTMLNode('div', 'mdxJsxFlowElement', [
      { type: 'mdxJsxAttribute', name: 'class', value: `markdown-alert markdown-alert-${alert.type}` },
    ])
    container.append($createAlertTitleNode(alert.type))
    ;(lexicalParent as ElementNode).append(container)
    actions.visitChildren({ ...mdastNode, children: alert.children }, container)
  },
}

/** 表示面でも書き出しは走るため、見出しは何も出さない visitor で読み飛ばす(無いと書き出しが例外になる) */
const alertTitleExportVisitor: LexicalExportVisitor<AlertTitleNode, MdastNode> = {
  testLexicalNode: $isAlertTitleNode,
  visitLexicalNode: () => {},
}

/**
 * GitHub 形式の注意書き(`> [!NOTE]` など5種)を、種類ごとの枠・アイコン・見出しで描画する。
 *
 * 表示専用。編集面では普通の引用のまま扱い、書き出しは `alertToMarkdownPlugin` が崩さないようにする。
 * 標準の blockquote visitor(priority 0)より高い優先度で、注意書きのときだけ引き取る。
 */
export const readOnlyAlertPlugin = realmPlugin({
  init: (realm) => {
    realm.pubIn({
      [addLexicalNode$]: AlertTitleNode,
      [addImportVisitor$]: alertVisitor,
      [addExportVisitor$]: alertTitleExportVisitor,
    })
  },
})
