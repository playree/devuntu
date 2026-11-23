'use client'

import Link from 'next/link'
import { CSSProperties, FC, Fragment, ReactNode, RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { tv } from 'tailwind-variants'
import { treeIdsToExpand } from './tree-expand'
import { useGeneralUiText } from './ui-text'

export type TreeViewItem = {
  id: string
  /** 親の id。null はルート直下 */
  parentId: string | null
  label: string
  /** 行のリンク先。無ければ文字だけを出す */
  href?: string
  /** ラベルの後ろに添える小さな表示(タグの印など)。ラベルが省略されても残る */
  suffix?: ReactNode
}

/** 行の操作(renderActions)に渡す、兄弟の中での位置 */
export type TreeViewItemPlace = { index: number; siblingCount: number }

/** lg 未満(スマホ)は指で押せるよう、行・開閉ボタン・ラベルを 32px の高さにする */
const rowStyles = tv({
  base: 'relative flex min-h-6 items-center gap-0.5 rounded-lg pr-1 text-sm max-lg:min-h-8',
  variants: {
    isSelected: {
      true: 'bg-accent-soft text-accent-soft-foreground font-semibold',
      false: 'hover:bg-mist-100 dark:hover:bg-neutral-900',
    },
  },
})

/** 1階層あたりの字下げ(px) */
const INDENT = 16
/** 開閉ボタン(size-6)の中心。親の縦線をこの位置に揃える */
const LINE_X = 12

const guideStyles = tv({
  /**
   * Markdown 設計書の表と同じく border で描く(背景の箱で描くと、表示倍率が整数でない環境で線ごとに太さが揃わない)。
   * 線どうしが重なった所(交点・行の境目)が濃くならないよう、半透明ではなく背景と混ぜた不透明色にする
   */
  base: 'pointer-events-none absolute border-[color-mix(in_oklab,var(--muted)_40%,var(--background))]',
  variants: {
    kind: {
      // 兄弟が続く縦線(│)。行間の gap-px で途切れないよう上に 1px はみ出させる
      pipe: '-top-px bottom-0 border-l',
      // 末尾の兄弟の縦線(└ の縦)
      elbow: '-top-px bottom-1/2 border-l',
      // 自分へつなぐ横線
      branch: 'top-1/2 border-t',
      // 開いている親の開閉ボタンの下から、子の縦線へつなぐ
      stem: 'top-[calc(50%+5px)] bottom-0 border-l',
    },
  },
})

/** 開閉ボタンの山形。Markdown 設計書の表と同じく、箱の右と下の線を回して描く(開くと ∨、閉じると >) */
const toggleMarkStyles = tv({
  base: 'size-1.5 border-r-[1.5px] border-b-[1.5px] border-current transition-transform',
  variants: {
    isExpanded: {
      true: '-mt-[3px] rotate-45',
      false: '-ml-[3px] -rotate-45',
    },
  },
})

/**
 * 親子をつなぐ線。`path[k]` は深さ k+1 の祖先(最後の要素は自分)が兄弟の末尾かどうか
 */
const TreeGuides: FC<{ path: readonly boolean[]; hasChildren: boolean; isExpanded: boolean }> = ({
  path,
  hasChildren,
  isExpanded,
}) => {
  const depth = path.length
  const line = (key: string, kind: 'pipe' | 'elbow' | 'branch' | 'stem', style: CSSProperties) => (
    <span key={key} aria-hidden className={guideStyles({ kind })} style={style} />
  )
  return (
    <>
      {path.map((isLast, k) => {
        const left = k * INDENT + LINE_X
        if (k < depth - 1) {
          return isLast ? null : line(`v${k}`, 'pipe', { left })
        }
        // 開閉ボタンのある行はボタンの手前まで、葉はラベルの手前まで横線を伸ばす
        const width = INDENT - LINE_X + (hasChildren ? 6 : 22)
        return (
          <Fragment key={k}>
            {line('v', isLast ? 'elbow' : 'pipe', { left })}
            {line('h', 'branch', { left, width })}
          </Fragment>
        )
      })}
      {hasChildren && isExpanded && line('stem', 'stem', { left: depth * INDENT + LINE_X })}
    </>
  )
}

/**
 * 行のラベル(リンク / 文字)。lg 未満は行の高さ(32px)いっぱいを押せるよう上下を広げ、
 * 開閉ボタンのはみ出し(右に 4px)と重ならないよう左を空ける
 */
const labelStyles = 'min-w-0 flex-1 truncate py-0.5 max-lg:ml-0.5 max-lg:py-1.5'

/**
 * 階層を持つ項目の一覧(サイドメニューのツリーなど)。
 *
 * - 開閉は内部で持つ。`selectedId` が変わると、その先祖と自分を開いて見える位置までスクロールする
 * - 入れ子の `ul` と開閉ボタン(aria-expanded)で組み、行の移動は Tab で行う
 * - 長いラベルは省略し、title 属性で全文を出す
 */
export const TreeView: FC<{
  'aria-label': string
  /** 兄弟の表示順に並べた項目 */
  items: readonly TreeViewItem[]
  selectedId?: string | null
  /** 行の右端に出す操作(並べ替えボタンなど) */
  renderActions?: (item: TreeViewItem, place: TreeViewItemPlace) => ReactNode
  /** リンクを押したとき(スマホでメニューを閉じるなど) */
  onNavigate?: () => void
  className?: string
}> = ({ 'aria-label': ariaLabel, items, selectedId, renderActions, onNavigate, className }) => {
  const { byId, children } = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]))
    const children = new Map<string | null, TreeViewItem[]>()
    for (const item of items) {
      // 親が見つからない項目はルート直下に出す(取りこぼして見えなくなるよりよい)
      const parentId = item.parentId && byId.has(item.parentId) ? item.parentId : null
      children.set(parentId, [...(children.get(parentId) ?? []), item])
    }
    return { byId, children }
  }, [items])

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  /**
   * 選択が変わったら先祖と自分を開き(子を辿るのに開閉ボタンを押し直さずに済む)、項目が変わったら先祖を開く。
   * 閉じているものだけを足し、利用者が開いた枝はそのまま残す。
   * 自分は子を持つときだけ足す(葉を開いたままにしておくと、後で子ができたときに開いて出てしまう)。
   * 項目の取り直しでは自分を足さないので、選んだ後に利用者が閉じた枝は閉じたまま
   */
  const [prevSelected, setPrevSelected] = useState<{ id: string | null | undefined; byId: typeof byId }>()
  if (prevSelected?.id !== selectedId || prevSelected?.byId !== byId) {
    setPrevSelected({ id: selectedId, byId })
    const withSelf = prevSelected?.id !== selectedId && !!selectedId && children.has(selectedId)
    const ids = treeIdsToExpand(byId, selectedId, withSelf)
    if (ids.some((id) => !expanded.has(id))) {
      setExpanded(new Set([...expanded, ...ids]))
    }
  }

  const selectedRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const toggle = (id: string) => {
    const next = new Set(expanded)
    if (!next.delete(id)) {
      next.add(id)
    }
    setExpanded(next)
  }

  return (
    <nav aria-label={ariaLabel} className={className}>
      <TreeLevel
        parentId={null}
        path={[]}
        nodes={children}
        expanded={expanded}
        selectedId={selectedId}
        selectedRef={selectedRef}
        renderActions={renderActions}
        onNavigate={onNavigate}
        toggle={toggle}
      />
    </nav>
  )
}

const TreeLevel: FC<{
  parentId: string | null
  /** 親の TreeGuides の path(ルート直下は空) */
  path: readonly boolean[]
  nodes: Map<string | null, TreeViewItem[]>
  expanded: ReadonlySet<string>
  selectedId?: string | null
  selectedRef: RefObject<HTMLAnchorElement | null>
  renderActions?: (item: TreeViewItem, place: TreeViewItemPlace) => ReactNode
  onNavigate?: () => void
  toggle: (id: string) => void
}> = (props) => {
  const { parentId, path, nodes, expanded, selectedId, selectedRef, renderActions, onNavigate, toggle } = props
  const uiText = useGeneralUiText()
  const siblings = nodes.get(parentId) ?? []

  return (
    <ul className='flex flex-col gap-px'>
      {siblings.map((item, index) => {
        const hasChildren = (nodes.get(item.id)?.length ?? 0) > 0
        const isExpanded = expanded.has(item.id)
        const isSelected = item.id === selectedId
        // ルート直下どうしは線でつながない
        const itemPath = parentId === null ? [] : [...path, index === siblings.length - 1]
        return (
          <li key={item.id}>
            <div
              className={rowStyles({ isSelected })}
              // 階層ごとに字下げする(Tailwind のクラスは動的に作れないので style で渡す)
              style={{ paddingLeft: `${itemPath.length * INDENT}px` }}
            >
              <TreeGuides path={itemPath} hasChildren={hasChildren} isExpanded={isExpanded} />
              {hasChildren ? (
                <button
                  type='button'
                  /**
                   * relative: 線(absolute)より手前に出し、ホバーの背景で線の端を隠す。背景は選択行(bg-accent-soft)の上でも見える色にする。
                   * lg 未満は 32px にするが、負のマージンで占める幅を 24px のままにして、中心(LINE_X)と字下げを変えない
                   */
                  className='text-muted hover:text-foreground hover:bg-default relative flex size-6 shrink-0 items-center justify-center rounded-[3px] max-lg:-mx-1 max-lg:size-8'
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? uiText.treeCollapse(item.label) : uiText.treeExpand(item.label)}
                  onClick={() => toggle(item.id)}
                >
                  <span aria-hidden className={toggleMarkStyles({ isExpanded })} />
                </button>
              ) : (
                <span className='size-6 shrink-0' />
              )}
              {item.href ? (
                <Link
                  href={item.href}
                  ref={isSelected ? selectedRef : undefined}
                  aria-current={isSelected ? 'page' : undefined}
                  title={item.label}
                  className={labelStyles}
                  onClick={onNavigate}
                >
                  {item.label}
                </Link>
              ) : (
                <span title={item.label} className={labelStyles}>
                  {item.label}
                </span>
              )}
              {item.suffix}
              {renderActions?.(item, { index, siblingCount: siblings.length })}
            </div>
            {hasChildren && isExpanded && <TreeLevel {...props} parentId={item.id} path={itemPath} />}
          </li>
        )
      })}
    </ul>
  )
}
