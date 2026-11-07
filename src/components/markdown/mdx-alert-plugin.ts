import { unescapeAlertMarker } from '@/lib/markdown-alert'
import { addToMarkdownExtension$, realmPlugin, ToMarkdownExtension } from '@mdxeditor/editor'

type BlockquoteHandler = NonNullable<NonNullable<ToMarkdownExtension['handlers']>['blockquote']>

/**
 * mdast-util-to-markdown 標準の blockquote ハンドラと同じ書き出しに、注意書きの目印のエスケープ戻しを足したもの。
 * 上書きすると標準のハンドラは呼べないため、処理を写している。
 */
const blockquote: BlockquoteHandler = (node, _, state, info) => {
  const exit = state.enter('blockquote')
  const tracker = state.createTracker(info)
  tracker.move('> ')
  tracker.shift(2)
  const value = state.indentLines(
    state.containerFlow(node, tracker.current()),
    (line, _index, blank) => '>' + (blank ? '' : ' ') + line,
  )
  exit()
  return unescapeAlertMarker(value)
}

/**
 * GitHub 形式の注意書き(`> [!NOTE]`)を、編集して保存しても崩さない。
 *
 * 編集面では普通の引用として扱うが、そのまま書き出すと目印の `[` がエスケープされて `> \[!NOTE]` になり、
 * 表示側で注意書きとして読めなくなる。
 */
export const alertToMarkdownPlugin = realmPlugin({
  init: (realm) => {
    realm.pub(addToMarkdownExtension$, { handlers: { blockquote } })
  },
})
