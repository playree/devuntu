import { isAllowedHtmlTag, isDroppedHtmlTag } from '@/lib/markdown-sanitize'
import { $createGenericHTMLNode, addImportVisitor$, MdastImportVisitor, MdastJsx, realmPlugin } from '@mdxeditor/editor'

/**
 * MDXEditor 本体の `MdastHTMLVisitor`(priority -100) は生HTMLのタグと属性を
 * 検査せずに DOM 化するため、それより先に mdxJsx ノードを捕まえて無害化する。
 * 許可外のタグはタグごと落として子だけを親に流し、許可タグでも属性は全て捨てる。
 *
 * インラインの `<u>` などはさらに優先度の高い formatting visitor(priority 0)が
 * 先に処理するので、ここには到達しない。
 */
const sanitizeHtmlVisitor: MdastImportVisitor<MdastJsx> = {
  priority: -50,
  testNode: (node) => node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement',
  visitNode({ mdastNode, lexicalParent, actions }) {
    if (isDroppedHtmlTag(mdastNode.name)) {
      return
    }
    if (isAllowedHtmlTag(mdastNode.name)) {
      actions.addAndStepInto($createGenericHTMLNode(mdastNode.name, mdastNode.type, []))
      return
    }
    actions.visitChildren(mdastNode, lexicalParent)
  },
}

export const sanitizeHtmlPlugin = realmPlugin({
  init: (realm) => {
    realm.pub(addImportVisitor$, sanitizeHtmlVisitor)
  },
})
