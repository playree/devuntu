'use client'

import { formatMentionSource, normalizeMentionText } from '@/lib/task'
import { DecoratorNode, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical'
import { createContext, FC, ReactNode, useContext, useMemo } from 'react'
import { tv } from 'tailwind-variants'

/** メンションの表示に必要なユーザー情報。`getAssigneeOptions` が返す形と構造的に一致させる */
export type MentionUser = {
  name: string
  email: string
  image?: string | null
  isAgent?: boolean
}

const EMPTY_USERS: MentionUser[] = []

const MentionUsersContext = createContext<Map<string, MentionUser>>(new Map())

/**
 * メンションの表示名を {@link MentionNode} へ渡す。
 *
 * 本文が持つのはメールアドレスだけで、表示名は描画時に引く。こうすると
 * 改名に追従できるうえ、候補一覧が非同期に届く画面でも後から名前が入る。
 * Lexical のノードは React の外で作られるため、生成時に名前を焼き付けることはできない。
 */
export const MentionUsersProvider: FC<{ users?: MentionUser[]; children: ReactNode }> = ({ users, children }) => {
  const value = useMemo(
    () => new Map((users ?? EMPTY_USERS).map((user) => [normalizeMentionText(user.email), user])),
    [users],
  )
  return <MentionUsersContext.Provider value={value}>{children}</MentionUsersContext.Provider>
}

const mentionStyles = tv({
  // em 指定なので、本文でも箇条書き(text-sm)でも常に周囲より一段小さくなる
  base: 'rounded-sm bg-blue-500/10 px-1 py-0.5 text-[0.85em] font-medium text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
})

/** 本文中のメンション 1 件。名前が引けない(ボードから外れた等)ならメールアドレスを出す */
const MentionLabel: FC<{ email: string }> = ({ email }) => {
  const users = useContext(MentionUsersContext)
  // Provider は正規化済みのメールアドレスをキーにしているので、引く側も同じ形に揃える
  const name = users.get(normalizeMentionText(email))?.name

  return (
    <span // 名前で表示しているときに実体を確かめられるようにする
      title={email}
      className={mentionStyles()}
    >
      @{name ?? email}
    </span>
  )
}

export type SerializedMentionNode = Spread<{ email: string }, SerializedLexicalNode>

/**
 * 本文中のメンション。Markdown 上は `@[メールアドレス]`、画面上は `@表示名` になる。
 *
 * TextNode ではなく DecoratorNode にしているのは、表示名を React 側で解決するため
 * ({@link MentionUsersProvider})。まとまりとして扱われるので、途中を編集して
 * 壊れたメンションが本文へ残ることもない。
 */
export class MentionNode extends DecoratorNode<ReactNode> {
  __email: string

  constructor(email: string, key?: NodeKey) {
    super(key)
    this.__email = email
  }

  static getType(): string {
    return 'mention'
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__email, node.__key)
  }

  static importJSON(serializedNode: SerializedMentionNode): MentionNode {
    return $createMentionNode(serializedNode.email).updateFromJSON(serializedNode)
  }

  exportJSON(): SerializedMentionNode {
    return { ...super.exportJSON(), email: this.__email }
  }

  getEmail(): string {
    return this.__email
  }

  createDOM(): HTMLElement {
    return document.createElement('span')
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): boolean {
    return true
  }

  /** コピーや文字数の計算に使われる。貼り戻したときに同じメンションへ戻る形にする */
  getTextContent(): string {
    return formatMentionSource(this.__email)
  }

  decorate(): ReactNode {
    return <MentionLabel email={this.__email} />
  }
}

export const $createMentionNode = (email: string): MentionNode => new MentionNode(normalizeMentionText(email))

export const $isMentionNode = (node: LexicalNode | null | undefined): node is MentionNode => node instanceof MentionNode
