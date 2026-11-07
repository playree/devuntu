/** 見出しの上端がスクロール元の上からこの割合より上に来たら、その見出しを現在の見出しとする */
export const TOC_CURRENT_RATIO = 0.2

/** 文書中でいちばん浅い見出しからの深さ(h2 と h3 だけの本文なら h2 が 0) */
export const tocDepths = (levels: number[]): number[] => {
  const minLevel = Math.min(...levels)
  return levels.map((level) => level - minLevel)
}

/** スクロール元の位置と大きさ。window のときは top が 0 */
export type ScrollBox = { top: number; scrollTop: number; clientHeight: number; scrollHeight: number }

/**
 * 現在の見出しとみなす上端の位置(画面上の y 座標)。
 * 末尾の見出しは閾値まで上がらないことがあるため、末尾までスクロールしたら画面内の最後の見出しを取れるよう広げる。
 * スクロールしない本文は先頭にいるとみなし、広げない
 */
export const currentThreshold = ({ top, scrollTop, clientHeight, scrollHeight }: ScrollBox): number => {
  const isAtEnd = scrollTop > 0 && scrollTop + clientHeight >= scrollHeight - 1
  return top + (isAtEnd ? clientHeight : clientHeight * TOC_CURRENT_RATIO)
}

/**
 * 上端が閾値より上にある最後の見出しの位置。無ければ -1。
 * 高さ 0 の見出し(表示されていないもの)は飛ばす
 */
export const findCurrentHeading = (rects: { top: number; height: number }[], threshold: number): number => {
  let current = -1
  for (const [i, rect] of rects.entries()) {
    if (rect.height === 0) {
      continue
    }
    if (rect.top > threshold) {
      break
    }
    current = i
  }
  return current
}

/**
 * 現在の見出しの位置。目次から選んだ見出し(pinned)は、選んだ直後のスクロール位置にある間はそれを優先する。
 * 短い節では次の見出しも閾値内に入り、末尾では最後の見出しが選ばれるため、選んだ項目と強調がずれる
 */
export const pickCurrentHeading = (
  rects: { top: number; height: number }[],
  box: ScrollBox,
  pinned?: { index: number; scrollTop: number },
): number => {
  if (pinned && rects[pinned.index]?.height && Math.abs(box.scrollTop - pinned.scrollTop) < 1) {
    return pinned.index
  }
  return findCurrentHeading(rects, currentThreshold(box))
}

/** 一覧(ページではなく一覧自身)の scrollTop を、項目が見える最小の動きにした値 */
export const revealScrollTop = ({
  itemTop,
  itemHeight,
  scrollTop,
  clientHeight,
}: {
  itemTop: number
  itemHeight: number
  scrollTop: number
  clientHeight: number
}): number => {
  if (itemTop < scrollTop) {
    return itemTop
  }
  if (itemTop + itemHeight > scrollTop + clientHeight) {
    return itemTop + itemHeight - clientHeight
  }
  return scrollTop
}
