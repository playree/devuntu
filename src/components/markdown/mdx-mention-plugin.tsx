'use client'

import { filterMentionCandidates, formatMentionText, matchMentionTrigger } from '@/lib/task'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { addComposerChild$, realmPlugin } from '@mdxeditor/editor'
import { $createTextNode, TextNode } from 'lexical'
import { createContext, FC, ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { MentionCandidate, MentionMenu } from './mention-menu'

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
 * `@` の入力でボードメンバーの候補を出し、選ぶとメンション記法を挿入する。
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
          const inserted = $createTextNode(formatMentionText(option.candidate.name))
          // 太字などの途中に打った場合でも見た目を揃える
          inserted.setFormat(nodeToReplace.getFormat())
          nodeToReplace.replace(inserted)
          inserted.selectEnd()
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
       * 発火しないため、空白を入れない日本語の文中で候補が出ない。
       * 本文からの抽出({@link extractMentionNames})と同じ前置ルールに揃える
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

export const mentionPlugin = realmPlugin({
  init: (realm) => {
    realm.pub(addComposerChild$, MentionTypeahead)
  },
})
