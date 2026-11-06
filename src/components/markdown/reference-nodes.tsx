'use client'

import { sanitizeLinkUrl } from '@/lib/markdown-sanitize'
import {
  DecoratorNode,
  ElementNode,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  SerializedLexicalNode,
  Spread,
} from 'lexical'
import { ReactNode } from 'react'

/** mdast の `linkReference` の参照の形。`full` = `[text][x]` / `collapsed` = `[x][]` / `shortcut` = `[x]` */
export type LinkReferenceType = 'full' | 'collapsed' | 'shortcut'

export type LinkReferenceInfo = {
  identifier: string
  label: string | null
  referenceType: LinkReferenceType
  /** 取り込んだ時点で定義から解決したリンク先。書き出しには使わない */
  url: string
  title: string | null
}

export type SerializedLinkReferenceNode = Spread<LinkReferenceInfo, SerializedElementNode>

/**
 * 参照リンク(`[text][x]` など)。表示は通常のリンクと同じで、書き出すと参照の形に戻る。
 *
 * MDXEditor が使う `LinkNode`(`@lexical/link`)は直接の依存に無く、継承できないため
 * 独自の ElementNode で `<a>` を描画する。href は `LinkNode` と同じ判定で無害化する。
 * リンク先は取り込んだ時点で定義から引いたもので、編集中に定義を消したり変えたりしても追従しない。
 * リンク先は定義(`[x]: url`)側にあるので、変えるときは source モードで定義を直す。
 */
export class LinkReferenceNode extends ElementNode {
  __info: LinkReferenceInfo

  constructor(info: LinkReferenceInfo, key?: NodeKey) {
    super(key)
    this.__info = info
  }

  static getType(): string {
    return 'link-reference'
  }

  static clone(node: LinkReferenceNode): LinkReferenceNode {
    return new LinkReferenceNode(node.__info, node.__key)
  }

  static importJSON(json: SerializedLinkReferenceNode): LinkReferenceNode {
    const { identifier, label, referenceType, url, title } = json
    return $createLinkReferenceNode({ identifier, label, referenceType, url, title }).updateFromJSON(json)
  }

  exportJSON(): SerializedLinkReferenceNode {
    return { ...super.exportJSON(), ...this.getInfo() }
  }

  getInfo(): LinkReferenceInfo {
    return this.getLatest().__info
  }

  createDOM(): HTMLElement {
    const anchor = document.createElement('a')
    // 空の href は表示中のページを指してしまう(表示面ではそれを新規タブで開く)ので付けない
    if (this.__info.url) {
      anchor.href = sanitizeLinkUrl(this.__info.url)
    }
    if (this.__info.title) {
      anchor.title = this.__info.title
    }
    return anchor
  }

  updateDOM(prevNode: LinkReferenceNode): boolean {
    return prevNode.__info !== this.__info
  }

  isInline(): true {
    return true
  }

  canBeEmpty(): false {
    return false
  }

  // リンクの外側で打った文字がリンクに含まれないようにする(LinkNode と同じ)
  canInsertTextBefore(): false {
    return false
  }

  canInsertTextAfter(): false {
    return false
  }
}

export const $createLinkReferenceNode = (info: LinkReferenceInfo): LinkReferenceNode => new LinkReferenceNode(info)

export const $isLinkReferenceNode = (node: LexicalNode | null | undefined): node is LinkReferenceNode =>
  node instanceof LinkReferenceNode

export type LinkDefinitionInfo = {
  identifier: string
  label: string | null
  url: string
  title: string | null
}

export type SerializedLinkDefinitionNode = Spread<LinkDefinitionInfo, SerializedLexicalNode>

/** 定義の記法そのもの。コピーや文字数の計算にも使う */
const formatDefinition = ({ identifier, label, url, title }: LinkDefinitionInfo) =>
  `[${label ?? identifier}]: ${url}${title ? ` "${title}"` : ''}`

/**
 * 参照リンクの定義行(`[x]: url "title"`)。書き出すと定義行に戻る。
 *
 * 表示面では描画しない(globals.css の `.mdxeditor-view [data-link-definition]`)。
 * 編集面では記法のまま薄く出し、消したり位置を変えたりできるようにする。中身の編集は source モードで行う。
 */
export class LinkDefinitionNode extends DecoratorNode<ReactNode> {
  __info: LinkDefinitionInfo

  constructor(info: LinkDefinitionInfo, key?: NodeKey) {
    super(key)
    this.__info = info
  }

  static getType(): string {
    return 'link-definition'
  }

  static clone(node: LinkDefinitionNode): LinkDefinitionNode {
    return new LinkDefinitionNode(node.__info, node.__key)
  }

  static importJSON(json: SerializedLinkDefinitionNode): LinkDefinitionNode {
    const { identifier, label, url, title } = json
    return $createLinkDefinitionNode({ identifier, label, url, title }).updateFromJSON(json)
  }

  exportJSON(): SerializedLinkDefinitionNode {
    return { ...super.exportJSON(), ...this.getInfo() }
  }

  getInfo(): LinkDefinitionInfo {
    return this.getLatest().__info
  }

  createDOM(): HTMLElement {
    const element = document.createElement('div')
    element.dataset.linkDefinition = ''
    return element
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): false {
    return false
  }

  getTextContent(): string {
    return formatDefinition(this.__info)
  }

  decorate(): ReactNode {
    return <span className='text-muted font-mono text-xs break-all'>{formatDefinition(this.__info)}</span>
  }
}

export const $createLinkDefinitionNode = (info: LinkDefinitionInfo): LinkDefinitionNode => new LinkDefinitionNode(info)

export const $isLinkDefinitionNode = (node: LexicalNode | null | undefined): node is LinkDefinitionNode =>
  node instanceof LinkDefinitionNode
