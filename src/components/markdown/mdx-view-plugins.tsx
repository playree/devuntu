import {
  $createGenericHTMLNode,
  addImportVisitor$,
  CodeBlockEditorDescriptor,
  MdastImportVisitor,
  realmPlugin,
  type isMdastHTMLNode,
} from '@mdxeditor/editor'

/** `@types/mdast` は直接の依存に無いため、公開 API の引数から mdast のノード型を取り出す */
type MdastNode = Parameters<typeof isMdastHTMLNode>[0]
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
  Editor: ({ code, language }) => (
    <pre className={language ? `language-${language}` : undefined}>
      <code>{code}</code>
    </pre>
  ),
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
