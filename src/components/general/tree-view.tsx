'use client'

import { cn } from '@heroui/react'
import Link from 'next/link'
import { FC, ReactNode, RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { tv } from 'tailwind-variants'
import { ChevronDownIcon } from './icons'
import { useGeneralUiText } from './ui-text'

export type TreeViewItem = {
  id: string
  /** 親の id。null はルート直下 */
  parentId: string | null
  label: string
  /** 行のリンク先。無ければ文字だけを出す */
  href?: string
}

/** 行の操作(renderActions)に渡す、兄弟の中での位置 */
export type TreeViewItemPlace = { index: number; siblingCount: number }

const rowStyles = tv({
  base: 'flex min-h-8 items-center gap-0.5 rounded-lg pr-1 text-sm',
  variants: {
    isSelected: {
      true: 'bg-accent-soft text-accent-soft-foreground font-semibold',
      false: 'hover:bg-mist-100 dark:hover:bg-neutral-900',
    },
  },
})

/**
 * 階層を持つ項目の一覧(サイドメニューのツリーなど)。
 *
 * - 開閉は内部で持つ。`selectedId` が変わると、その先祖を開いて見える位置までスクロールする
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

  // 選択が変わったら先祖を開く(閉じているものだけを足し、利用者が開いた枝はそのまま残す)
  const [prevSelected, setPrevSelected] = useState<{ id: string | null | undefined; byId: typeof byId }>()
  if (prevSelected?.id !== selectedId || prevSelected?.byId !== byId) {
    setPrevSelected({ id: selectedId, byId })
    const ancestors: string[] = []
    const seen = new Set<string>()
    for (let id = selectedId && byId.get(selectedId)?.parentId; id && !seen.has(id); id = byId.get(id)?.parentId) {
      seen.add(id)
      ancestors.push(id)
    }
    if (ancestors.some((id) => !expanded.has(id))) {
      setExpanded(new Set([...expanded, ...ancestors]))
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
        depth={0}
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
  depth: number
  nodes: Map<string | null, TreeViewItem[]>
  expanded: ReadonlySet<string>
  selectedId?: string | null
  selectedRef: RefObject<HTMLAnchorElement | null>
  renderActions?: (item: TreeViewItem, place: TreeViewItemPlace) => ReactNode
  onNavigate?: () => void
  toggle: (id: string) => void
}> = (props) => {
  const { parentId, depth, nodes, expanded, selectedId, selectedRef, renderActions, onNavigate, toggle } = props
  const uiText = useGeneralUiText()
  const siblings = nodes.get(parentId) ?? []

  return (
    <ul className='flex flex-col gap-px'>
      {siblings.map((item, index) => {
        const hasChildren = (nodes.get(item.id)?.length ?? 0) > 0
        const isExpanded = expanded.has(item.id)
        const isSelected = item.id === selectedId
        return (
          <li key={item.id}>
            <div
              className={rowStyles({ isSelected })}
              // 階層ごとに字下げする(Tailwind のクラスは動的に作れないので style で渡す)
              style={{ paddingLeft: `${depth * 12}px` }}
            >
              {hasChildren ? (
                <button
                  type='button'
                  className='text-muted hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded'
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? uiText.treeCollapse(item.label) : uiText.treeExpand(item.label)}
                  onClick={() => toggle(item.id)}
                >
                  <ChevronDownIcon width={14} className={cn('transition-transform', !isExpanded && '-rotate-90')} />
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
                  className='min-w-0 flex-1 truncate py-1'
                  onClick={onNavigate}
                >
                  {item.label}
                </Link>
              ) : (
                <span title={item.label} className='min-w-0 flex-1 truncate py-1'>
                  {item.label}
                </span>
              )}
              {renderActions?.(item, { index, siblingCount: siblings.length })}
            </div>
            {hasChildren && isExpanded && <TreeLevel {...props} parentId={item.id} depth={depth + 1} />}
          </li>
        )
      })}
    </ul>
  )
}
