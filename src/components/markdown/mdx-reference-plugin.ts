import { ResolvedDefinition, resolveMarkdownReferences } from '@/lib/markdown-reference'
import {
  $createImageNode,
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addToMarkdownExtension$,
  LexicalExportVisitor,
  MdastImportVisitor,
  realmPlugin,
  ToMarkdownExtension,
} from '@mdxeditor/editor'
import { $createTextNode } from 'lexical'
import { MdastNode } from './mdast-types'
import {
  $createLinkDefinitionNode,
  $createLinkReferenceNode,
  $isLinkDefinitionNode,
  $isLinkReferenceNode,
  LinkDefinitionNode,
  LinkReferenceNode,
} from './reference-nodes'

type MdastRoot = Extract<MdastNode, { type: 'root' }>
type MdastDefinition = Extract<MdastNode, { type: 'definition' }>
type MdastLinkReference = Extract<MdastNode, { type: 'linkReference' }>
type MdastImageReference = Extract<MdastNode, { type: 'imageReference' }>

/**
 * 参照ノード → 解決した定義。
 *
 * 文書単位ではなく参照ノード自体に紐づけるのは、編集面の表(tablePlugin)がセルの中身を
 * 元の mdast ノードのまま後から別の root として取り込むため。その root には定義が無いので
 * 解決できなかった参照は上書きせず、最初の取り込みで引いた結果を使い続ける。
 */
const resolvedReferences = new WeakMap<object, ResolvedDefinition>()

/**
 * 書き出した mdast の参照に持たせる、解決済みの定義。Markdown には出力されない。
 *
 * 表のセルは編集を確定するたびに書き出した mdast で取り込み直されるため、
 * 元の mdast ノードに紐づけた {@link resolvedReferences} では引けなくなる。
 */
type ResolvedData = { resolvedDefinition?: ResolvedDefinition }

const findDefinition = (node: MdastLinkReference): ResolvedDefinition | undefined =>
  resolvedReferences.get(node) ?? (node.data as ResolvedData | undefined)?.resolvedDefinition

/** 取り込みの最初に木全体から定義を引いておき、標準の root visitor へ戻す */
const resolveReferencesVisitor: MdastImportVisitor<MdastRoot> = {
  priority: 100,
  testNode: 'root',
  visitNode({ mdastNode, actions }) {
    for (const [reference, definition] of resolveMarkdownReferences<MdastNode>(mdastNode)) {
      resolvedReferences.set(reference, definition)
    }
    actions.nextVisitor()
  },
}

const definitionImportVisitor: MdastImportVisitor<MdastDefinition> = {
  testNode: 'definition',
  visitNode({ mdastNode, actions }) {
    const { identifier, label, url, title } = mdastNode
    actions.addAndStepInto($createLinkDefinitionNode({ identifier, label: label ?? null, url, title: title ?? null }))
  },
}

const linkReferenceImportVisitor: MdastImportVisitor<MdastLinkReference> = {
  testNode: 'linkReference',
  visitNode({ mdastNode, actions }) {
    const { identifier, label, referenceType } = mdastNode
    // 定義が引けない場合も参照の形は保ったまま書き出せるよう、リンク先なしのノードにする
    const definition = findDefinition(mdastNode)
    actions.addAndStepInto(
      $createLinkReferenceNode({
        identifier,
        label: label ?? null,
        referenceType,
        url: definition?.url ?? '',
        title: definition?.title ?? null,
      }),
    )
  },
}

/** 参照画像は解決した URL の通常の画像にする。書き出すとインラインの `![alt](url)` になる */
const imageReferenceImportVisitor: MdastImportVisitor<MdastImageReference> = {
  testNode: 'imageReference',
  visitNode({ mdastNode, actions }) {
    const definition = resolvedReferences.get(mdastNode)
    const altText = mdastNode.alt ?? ''
    actions.addAndStepInto(
      definition
        ? $createImageNode({ src: definition.url, altText, title: definition.title ?? '' })
        : $createTextNode(altText),
    )
  },
}

const linkReferenceExportVisitor: LexicalExportVisitor<LinkReferenceNode, MdastLinkReference> = {
  testLexicalNode: $isLinkReferenceNode,
  visitLexicalNode({ lexicalNode, actions }) {
    const { identifier, label, referenceType, url, title } = lexicalNode.getInfo()
    const data: ResolvedData | undefined = url ? { resolvedDefinition: { url, title } } : undefined
    actions.addAndStepInto('linkReference', { identifier, label, referenceType, data })
  },
}

const definitionExportVisitor: LexicalExportVisitor<LinkDefinitionNode, MdastDefinition> = {
  testLexicalNode: $isLinkDefinitionNode,
  visitLexicalNode({ lexicalNode, actions }) {
    const { identifier, label, url, title } = lexicalNode.getInfo()
    actions.addAndStepInto('definition', { identifier, label, url, title }, false)
  },
}

/** 定義が続くときは空行を挟まず、まとめて書いた形を保つ(既定ではブロックの間に空行が入る) */
const definitionToMarkdown: ToMarkdownExtension = {
  join: [(left, right) => (left.type === 'definition' && right.type === 'definition' ? 0 : undefined)],
}

/**
 * 参照リンクの記法(`[text][x]` / `[x][]` / `[x]` / `![alt][x]` と定義 `[x]: url`)。
 *
 * MDXEditor 本体はこれらの import visitor を持たず、含む本文の取り込みが丸ごと失敗する。
 */
export const referencePlugin = realmPlugin({
  init: (realm) => {
    realm.pubIn({
      [addLexicalNode$]: [LinkReferenceNode, LinkDefinitionNode],
      [addImportVisitor$]: [
        resolveReferencesVisitor,
        definitionImportVisitor,
        linkReferenceImportVisitor,
        imageReferenceImportVisitor,
      ],
      [addExportVisitor$]: [linkReferenceExportVisitor, definitionExportVisitor],
      [addToMarkdownExtension$]: definitionToMarkdown,
    })
  },
})
