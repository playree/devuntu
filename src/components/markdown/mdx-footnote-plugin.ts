import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  addSyntaxExtension$,
  addToMarkdownExtension$,
  LexicalExportVisitor,
  MdastImportVisitor,
  realmPlugin,
} from '@mdxeditor/editor'
import { $createParagraphNode } from 'lexical'
import { gfmFootnoteFromMarkdown, gfmFootnoteToMarkdown } from 'mdast-util-gfm-footnote'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'
import {
  $createFootnoteDefinitionNode,
  $createFootnoteReferenceNode,
  $isFootnoteDefinitionNode,
  $isFootnoteReferenceNode,
  FootnoteDefinitionNode,
  FootnoteReferenceNode,
} from './footnote-nodes'
import { MdastNode } from './mdast-types'

type MdastFootnoteReference = Extract<MdastNode, { type: 'footnoteReference' }>
type MdastFootnoteDefinition = Extract<MdastNode, { type: 'footnoteDefinition' }>

const footnoteReferenceImportVisitor: MdastImportVisitor<MdastFootnoteReference> = {
  testNode: 'footnoteReference',
  visitNode({ mdastNode, actions }) {
    actions.addAndStepInto(
      $createFootnoteReferenceNode({ identifier: mdastNode.identifier, label: mdastNode.label ?? null }),
    )
  },
}

const footnoteDefinitionImportVisitor: MdastImportVisitor<MdastFootnoteDefinition> = {
  testNode: 'footnoteDefinition',
  visitNode({ mdastNode, actions }) {
    const node = $createFootnoteDefinitionNode({ identifier: mdastNode.identifier, label: mdastNode.label ?? null })
    // 本文の無い定義(`[^1]:`)でもカーソルを置けるよう、空の段落を持たせる
    if (mdastNode.children.length === 0) {
      node.append($createParagraphNode())
    }
    actions.addAndStepInto(node)
  },
}

const footnoteReferenceExportVisitor: LexicalExportVisitor<FootnoteReferenceNode, MdastFootnoteReference> = {
  testLexicalNode: $isFootnoteReferenceNode,
  visitLexicalNode({ lexicalNode, actions }) {
    actions.addAndStepInto('footnoteReference', lexicalNode.getInfo(), false)
  },
}

const footnoteDefinitionExportVisitor: LexicalExportVisitor<FootnoteDefinitionNode, MdastFootnoteDefinition> = {
  testLexicalNode: $isFootnoteDefinitionNode,
  visitLexicalNode({ lexicalNode, actions }) {
    actions.addAndStepInto('footnoteDefinition', lexicalNode.getInfo())
  },
}

/**
 * GFM の脚注(参照 `[^1]` と定義 `[^1]: 本文`)。
 *
 * MDXEditor は脚注の構文拡張を持たないため、micromark / mdast の拡張を足して解釈させる。
 * 拡張が無いと定義行が URL `本文` の参照リンク定義として読まれ、本文全体の取り込みも失敗する。
 * 定義は GitHub のように末尾へ集めず、書いた位置に出す(保存しても位置が変わらないように)。
 */
export const footnotePlugin = realmPlugin({
  init: (realm) => {
    realm.pubIn({
      [addSyntaxExtension$]: gfmFootnote(),
      [addMdastExtension$]: gfmFootnoteFromMarkdown(),
      [addToMarkdownExtension$]: gfmFootnoteToMarkdown(),
      [addLexicalNode$]: [FootnoteReferenceNode, FootnoteDefinitionNode],
      [addImportVisitor$]: [footnoteReferenceImportVisitor, footnoteDefinitionImportVisitor],
      [addExportVisitor$]: [footnoteReferenceExportVisitor, footnoteDefinitionExportVisitor],
    })
  },
})
