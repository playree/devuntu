'use client'

import { AlertType } from '@/lib/markdown-alert'
import { DecoratorNode, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical'
import { FC, ReactNode, SVGProps } from 'react'
import { ChatBubbleIcon, ExclamationTriangleIcon, InformationCircleIcon, LightBulbIcon, XCircleIcon } from '../icon'

/** 見出しは GitHub と同じ英語の名前で固定する(記法の一部として読ませるため、ロケールで訳さない) */
const ALERT_TITLES: Record<AlertType, { label: string; Icon: FC<SVGProps<SVGSVGElement>> }> = {
  note: { label: 'Note', Icon: InformationCircleIcon },
  tip: { label: 'Tip', Icon: LightBulbIcon },
  important: { label: 'Important', Icon: ChatBubbleIcon },
  warning: { label: 'Warning', Icon: ExclamationTriangleIcon },
  caution: { label: 'Caution', Icon: XCircleIcon },
}

export type SerializedAlertTitleNode = Spread<{ alertType: AlertType }, SerializedLexicalNode>

/** 注意書きの見出し(アイコン+種類名)。表示専用で、Markdown へは書き出さない */
export class AlertTitleNode extends DecoratorNode<ReactNode> {
  __alertType: AlertType

  constructor(alertType: AlertType, key?: NodeKey) {
    super(key)
    this.__alertType = alertType
  }

  static getType(): string {
    return 'alert-title'
  }

  static clone(node: AlertTitleNode): AlertTitleNode {
    return new AlertTitleNode(node.__alertType, node.__key)
  }

  static importJSON(json: SerializedAlertTitleNode): AlertTitleNode {
    return $createAlertTitleNode(json.alertType).updateFromJSON(json)
  }

  exportJSON(): SerializedAlertTitleNode {
    return { ...super.exportJSON(), alertType: this.__alertType }
  }

  createDOM(): HTMLElement {
    return document.createElement('div')
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): false {
    return false
  }

  getTextContent(): string {
    return ALERT_TITLES[this.__alertType].label
  }

  decorate(): ReactNode {
    const { label, Icon } = ALERT_TITLES[this.__alertType]
    return (
      <p className='markdown-alert-title'>
        <Icon width={16} />
        {label}
      </p>
    )
  }
}

export const $createAlertTitleNode = (alertType: AlertType): AlertTitleNode => new AlertTitleNode(alertType)

export const $isAlertTitleNode = (node: LexicalNode | null | undefined): node is AlertTitleNode =>
  node instanceof AlertTitleNode
