'use client'

import { filterMentionCandidates, findMentions, formatMentionSource, matchMentionTrigger } from '@/lib/task'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  addComposerChild$,
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addToMarkdownExtension$,
  LexicalExportVisitor,
  MdastImportVisitor,
  realmPlugin,
  ToMarkdownExtension,
  type isMdastHTMLNode,
} from '@mdxeditor/editor'
import { $createTextNode, TextNode } from 'lexical'
import { createContext, FC, ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { MentionCandidate, MentionMenu } from './mention-menu'
import { $createMentionNode, $isMentionNode, MentionNode } from './mention-node'

/** `@types/mdast` は直接の依存に無いため、公開 API の引数から mdast のノード型を取り出す */
type MdastNode = Parameters<typeof isMdastHTMLNode>[0]
type MdastText = Extract<MdastNode, { type: 'text' }>

/** 本文の書き出しに使う独自の mdast ノード。標準の text として出すと `[` がエスケープされてしまう */
type MdastMention = { type: 'mention'; email: string }

const EMPTY_CANDIDATES: MentionCandidate[] = []

const MentionCandidatesContext = createContext<MentionCandidate[]>(EMPTY_CANDIDATES)

/**
 * メンション候補を {@link MentionTypeahead} へ渡す。
 *
 * MDXEditor の `plugins` 配列はマウント後に差し替えられない(差し替えると Lexical が
 * 組み直され編集中の内容が失われる)ため、非同期に届く候補をプラグインの引数では渡せない。
 * `addComposerChild$` の子は MDXEditor の React ツリー内に描画されるので、
 * MDXEditor の外側に置いたこの Provider の値がそのまま届く。
 */
export const MentionCandidatesProvider: FC<{ candidates?: MentionCandidate[]; children: ReactNode }> = ({
  candidates,
  children,
}) => (
  <MentionCandidatesContext.Provider value={candidates ?? EMPTY_CANDIDATES}>
    {children}
  </MentionCandidatesContext.Provider>
)

/** Lexical の typeahead が要求する選択肢。表示に使う候補を持たせる */
class MentionOption extends MenuOption {
  candidate: MentionCandidate

  constructor(candidate: MentionCandidate) {
    super(candidate.id)
    this.candidate = candidate
  }
}

/**
 * `@` の入力でボードメンバーの候補を出し、選ぶとメンションを挿入する。
 *
 * IME 変換中の抑制・↑↓ / Enter / Tab / Escape・キャレット位置への追従は
 * LexicalTypeaheadMenuPlugin 側が持つ。ここは候補の絞り込みと挿入だけを担う。
 * 候補が空(ボード文脈の無いエディタ)なら一覧は出ない。
 */
const MentionTypeahead: FC = () => {
  const [editor] = useLexicalComposerContext()
  const candidates = useContext(MentionCandidatesContext)
  // null = メンションを入力していない
  const [query, setQuery] = useState<string | null>(null)

  const options = useMemo(
    () => (query === null ? [] : filterMentionCandidates(candidates, query).map((c) => new MentionOption(c))),
    [candidates, query],
  )

  const insert = useCallback(
    (option: MentionOption, nodeToReplace: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        // nodeToReplace は入力中の `@クエリ` だけに切り出された TextNode
        if (nodeToReplace) {
          const mention = $createMentionNode(option.candidate.email)
          // 続けて入力しやすいよう空白を足す。太字などの途中に打った場合でも見た目を揃える
          const spacer = $createTextNode(' ')
          spacer.setFormat(nodeToReplace.getFormat())
          nodeToReplace.replace(mention)
          mention.insertAfter(spacer)
          spacer.selectEnd()
        }
        closeMenu()
      })
    },
    [editor],
  )

  return (
    <LexicalTypeaheadMenuPlugin<MentionOption>
      options={options}
      /**
       * `useBasicTypeaheadTriggerMatch` は使わない。`@` の直前が行頭 / 空白 / `(` でないと
       * 発火しないため、空白を入れない日本語の文中で候補が出ない
       */
      triggerFn={matchMentionTrigger}
      onQueryChange={setQuery}
      onSelectOption={insert}
      menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => (
        <MentionMenu
          anchor={anchorRef.current}
          items={options.map((option) => ({
            ...option.candidate,
            setElement: (element) => option.setRefElement(element),
          }))}
          selectedIndex={selectedIndex}
          onSelect={(index) => selectOptionAndCleanUp(options[index])}
          onHighlight={setHighlightedIndex}
        />
      )}
    />
  )
}

/**
 * 本文中の `@[メールアドレス]` を {@link MentionNode} へ差し替える。
 *
 * mdast の text ノードだけを見るので、コードブロック / インラインコードは自然に対象外になる。
 * メンションを含まない大多数のテキストは `nextVisitor` で標準の text visitor へ戻す。
 */
const mentionImportVisitor: MdastImportVisitor<MdastText> = {
  priority: 1,
  testNode: 'text',
  visitNode({ mdastNode, actions }) {
    const mentions = findMentions(mdastNode.value)
    if (mentions.length === 0) {
      actions.nextVisitor()
      return
    }

    const format = actions.getParentFormatting()
    const style = actions.getParentStyle()
    const addText = (value: string) => {
      if (!value) {
        return
      }
      const node = $createTextNode(value)
      node.setFormat(format)
      if (style !== '') {
        node.setStyle(style)
      }
      actions.addAndStepInto(node)
    }

    let rest = 0
    for (const { email, index, length } of mentions) {
      addText(mdastNode.value.slice(rest, index))
      actions.addAndStepInto($createMentionNode(email))
      rest = index + length
    }
    addText(mdastNode.value.slice(rest))
  },
}

const mentionExportVisitor: LexicalExportVisitor<MentionNode, MdastText> = {
  testLexicalNode: $isMentionNode,
  visitLexicalNode: ({ lexicalNode, actions }) => {
    actions.addAndStepInto('mention', { email: lexicalNode.getEmail() }, false)
  },
}

/** 独自ノードの書き出し。handler の戻り値はエスケープされないので角括弧をそのまま出せる */
const mentionHandler = (node: MdastMention) => formatMentionSource(node.email)
// 直前のテキストのエスケープ判定に使われる(付けないと書き出しが二度走る)
mentionHandler.peek = () => '@'

const mentionToMarkdown: ToMarkdownExtension = {
  // mdast の標準ノードではないため、ハンドラの型には載らない
  handlers: { mention: mentionHandler } as ToMarkdownExtension['handlers'],
}

/**
 * メンションの記法と表示。`typeahead` を指定したときだけ `@` の入力補助も付ける
 * (表示専用のエディタでは候補を出さない)。
 */
export const mentionPlugin = realmPlugin<{ typeahead?: boolean }>({
  init: (realm, params) => {
    realm.pubIn({
      [addLexicalNode$]: MentionNode,
      [addImportVisitor$]: mentionImportVisitor,
      [addExportVisitor$]: mentionExportVisitor,
      [addToMarkdownExtension$]: mentionToMarkdown,
    })
    if (params?.typeahead) {
      realm.pub(addComposerChild$, MentionTypeahead)
    }
  },
})
