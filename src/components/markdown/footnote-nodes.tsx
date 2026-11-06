'use client'

import {
  DecoratorNode,
  ElementDOMSlot,
  ElementNode,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  SerializedLexicalNode,
  Spread,
} from 'lexical'
import { FC, MouseEvent, ReactNode } from 'react'

export type FootnoteInfo = {
  /** mdast で正規化された識別子。参照と定義の対応付けに使う */
  identifier: string
  /** 書いたときのラベル(`[^Note]` の `Note`)。表示と書き出しに使う */
  label: string | null
}

const displayLabel = ({ identifier, label }: FootnoteInfo) => label ?? identifier

/** 定義の DOM に付ける目印。参照のクリックで同じ本文内から探す */
const DEFINITION_ATTR = 'data-footnote-definition'

/**
 * 脚注の参照。クリックで同じ本文内の定義までスクロールする。
 *
 * id で飛ばさないのは、コメント一覧のように本文が 1 画面に複数並ぶと `[^1]` の id が衝突するため。
 * `<a>` にしないのは、表示面がリンクを新規タブで開く処理(mdx-view-core.tsx)に拾われないようにするため。
 */
const FootnoteReferenceLabel: FC<FootnoteInfo> = (info) => {
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const root = e.currentTarget.closest('.markdown')
    root?.querySelector(`[${DEFINITION_ATTR}="${CSS.escape(info.identifier)}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  return (
    <sup>
      <button type='button' className='cursor-pointer px-0.5 leading-none text-blue-600' onClick={onClick}>
        {displayLabel(info)}
      </button>
    </sup>
  )
}

export type SerializedFootnoteReferenceNode = Spread<FootnoteInfo, SerializedLexicalNode>

/** 脚注の参照(`[^1]`)。書いたラベルを上付きで出す */
export class FootnoteReferenceNode extends DecoratorNode<ReactNode> {
  __info: FootnoteInfo

  constructor(info: FootnoteInfo, key?: NodeKey) {
    super(key)
    this.__info = info
  }

  static getType(): string {
    return 'footnote-reference'
  }

  static clone(node: FootnoteReferenceNode): FootnoteReferenceNode {
    return new FootnoteReferenceNode(node.__info, node.__key)
  }

  static importJSON(json: SerializedFootnoteReferenceNode): FootnoteReferenceNode {
    return $createFootnoteReferenceNode({ identifier: json.identifier, label: json.label }).updateFromJSON(json)
  }

  exportJSON(): SerializedFootnoteReferenceNode {
    return { ...super.exportJSON(), ...this.getInfo() }
  }

  getInfo(): FootnoteInfo {
    return this.getLatest().__info
  }

  createDOM(): HTMLElement {
    return document.createElement('span')
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): true {
    return true
  }

  getTextContent(): string {
    return `[^${displayLabel(this.__info)}]`
  }

  decorate(): ReactNode {
    return <FootnoteReferenceLabel {...this.__info} />
  }
}

export const $createFootnoteReferenceNode = (info: FootnoteInfo): FootnoteReferenceNode =>
  new FootnoteReferenceNode(info)

export const $isFootnoteReferenceNode = (node: LexicalNode | null | undefined): node is FootnoteReferenceNode =>
  node instanceof FootnoteReferenceNode

export type SerializedFootnoteDefinitionNode = Spread<FootnoteInfo, SerializedElementNode>

/**
 * 脚注の定義(`[^1]: 本文`)。書いた位置に、ラベルと本文を並べたブロックとして出す。
 *
 * 本文は段落やリストを複数持てるので、表のセルと同じく shadow root にして
 * 中の段落を通常どおり編集できるようにする(先頭で Backspace しても外へ結合しない)。
 * ラベルは編集対象ではないので、子を入れる要素(getDOMSlot)とは別の要素に出す。
 */
export class FootnoteDefinitionNode extends ElementNode {
  __info: FootnoteInfo

  constructor(info: FootnoteInfo, key?: NodeKey) {
    super(key)
    this.__info = info
  }

  static getType(): string {
    return 'footnote-definition'
  }

  static clone(node: FootnoteDefinitionNode): FootnoteDefinitionNode {
    return new FootnoteDefinitionNode(node.__info, node.__key)
  }

  static importJSON(json: SerializedFootnoteDefinitionNode): FootnoteDefinitionNode {
    return $createFootnoteDefinitionNode({ identifier: json.identifier, label: json.label }).updateFromJSON(json)
  }

  exportJSON(): SerializedFootnoteDefinitionNode {
    return { ...super.exportJSON(), ...this.getInfo() }
  }

  getInfo(): FootnoteInfo {
    return this.getLatest().__info
  }

  createDOM(): HTMLElement {
    const element = document.createElement('div')
    element.setAttribute(DEFINITION_ATTR, this.__info.identifier)
    const label = document.createElement('span')
    label.contentEditable = 'false'
    label.dataset.footnoteLabel = ''
    label.textContent = displayLabel(this.__info)
    const body = document.createElement('div')
    body.dataset.footnoteBody = ''
    element.append(label, body)
    return element
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot<HTMLElement> {
    return super.getDOMSlot(element).withElement(element.querySelector<HTMLElement>('[data-footnote-body]') ?? element)
  }

  updateDOM(prevNode: FootnoteDefinitionNode): boolean {
    return prevNode.__info !== this.__info
  }

  isShadowRoot(): boolean {
    return true
  }

  canBeEmpty(): false {
    return false
  }

  canIndent(): false {
    return false
  }
}

export const $createFootnoteDefinitionNode = (info: FootnoteInfo): FootnoteDefinitionNode =>
  new FootnoteDefinitionNode(info)

export const $isFootnoteDefinitionNode = (node: LexicalNode | null | undefined): node is FootnoteDefinitionNode =>
  node instanceof FootnoteDefinitionNode
