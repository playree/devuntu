'use client'

import { MultiButton } from '@/components/general/button'
import { ListBulletIcon } from '@/components/icon'
import { pickCurrentHeading, revealScrollTop, ScrollBox, tocDepths } from '@/lib/markdown-toc'
import { useLocale } from '@/locale/client'
import { Popover } from '@heroui/react'
import { CSSProperties, FC, RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { tv } from 'tailwind-variants'

/** 目次に載せる見出し。本文はコメント欄にも並ぶので id は振らず、要素を直接持つ */
const HEADING_SELECTOR = '.markdown :is(h1, h2, h3)'

type Entry = { heading: HTMLElement; text: string; depth: number }

/**
 * 開いた状態の見た目は globals.css の `toc-open` variant で付ける。
 * 閉じた状態は見出しごとの短い線を並べ、ホバーかキーボードフォーカスで一覧に開く
 */
const tocStyle = tv({
  slots: {
    nav: [
      'fixed top-1/2 z-20 flex max-h-[70vh] w-4 -translate-y-1/2 flex-col rounded-md border border-transparent py-1.5 text-[13px] leading-snug print:hidden',
      'toc-open:border-border toc-open:bg-background toc-open:w-max toc-open:max-w-[min(320px,60vw)] toc-open:mr-1 toc-open:min-w-40 toc-open:px-1.5 toc-open:shadow-lg',
    ],
    title: 'text-muted toc-open:block hidden px-2 pb-1 text-[11px] font-semibold',
    list: 'toc-open:overflow-y-auto relative min-h-0 overflow-hidden',
    button: [
      'relative block h-2 w-full cursor-pointer truncate text-left focus-visible:outline-1 focus-visible:-outline-offset-1',
      'toc-open:h-auto toc-open:rounded-sm toc-open:border-l-2 toc-open:border-transparent toc-open:py-0.5 toc-open:pr-2 toc-open:pl-[calc(8px+var(--toc-depth)*12px)] toc-open:hover:bg-default',
    ],
    line: 'bg-muted/40 toc-open:hidden absolute top-0.75 right-0.5 h-0.5 w-[calc(12px-var(--toc-depth)*4px)] rounded-full',
    text: 'toc-open:inline hidden',
  },
  variants: {
    isCurrent: {
      true: { button: 'toc-open:border-accent toc-open:text-accent', line: 'bg-accent' },
    },
  },
})

/** 脚注の参照(上付きの番号)を除いた見出しの文字列 */
const headingText = (heading: HTMLElement) => {
  const clone = heading.cloneNode(true) as HTMLElement
  clone.querySelectorAll('sup').forEach((sup) => sup.remove())
  return (clone.textContent ?? '').trim()
}

/** 本文をスクロールさせている要素。詳細ページでは window(null)、サイドパネルではパネル自身 */
const findScroller = (el: HTMLElement): HTMLElement | null => {
  for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent)
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
      return parent
    }
  }
  return null
}

/** スクロール元の位置と、目次を寄せる右端(スクロールバーの内側)までの距離 */
const measureScroller = (scroller: HTMLElement | null): ScrollBox & { right: number } => {
  const root = document.documentElement
  if (!scroller) {
    return {
      top: 0,
      scrollTop: window.scrollY,
      clientHeight: root.clientHeight,
      scrollHeight: root.scrollHeight,
      right: 0,
    }
  }
  const rect = scroller.getBoundingClientRect()
  return {
    top: rect.top + scroller.clientTop,
    scrollTop: scroller.scrollTop,
    clientHeight: scroller.clientHeight,
    scrollHeight: scroller.scrollHeight,
    right: root.clientWidth - (rect.left + scroller.clientLeft + scroller.clientWidth),
  }
}

const isSameEntries = (a: Entry[], b: Entry[]) =>
  a.length === b.length && a.every((entry, i) => entry.heading === b[i].heading && entry.text === b[i].text)

const HOVER_NONE = '(hover: none)'
const subscribeHoverNone = (onChange: () => void) => {
  const query = window.matchMedia(HOVER_NONE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
/** ホバーできない端末(タッチ操作)か */
const useIsHoverNone = () =>
  useSyncExternalStore(
    subscribeHoverNone,
    () => window.matchMedia(HOVER_NONE).matches,
    () => false,
  )

/** target 内の見出しと現在の見出し、目次を寄せる右端の位置を追う */
const useTocEntries = (targetRef: RefObject<HTMLElement | null>) => {
  const [entries, setEntries] = useState<Entry[]>([])
  const [current, setCurrent] = useState(-1)
  const [right, setRight] = useState(0)
  /** 目次から選んだ見出しと、選んだ直後のスクロール位置。そこから動くまではこの見出しを現在とする */
  const pinnedRef = useRef<{ heading: HTMLElement; scrollTop: number } | null>(null)
  const scheduleRef = useRef<() => void>(() => {})

  useEffect(() => {
    const target = targetRef.current
    if (!target) {
      return
    }
    let headings: HTMLElement[] = []
    let scroller: HTMLElement | null = null
    let needsCollect = true
    let needsScroller = true
    let lastRight: number | undefined
    let frame = 0

    const update = () => {
      frame = 0
      if (needsCollect) {
        needsCollect = false
        const found = Array.from(target.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
          .map((heading) => ({ heading, level: Number(heading.tagName[1]), text: headingText(heading) }))
          .filter((entry) => entry.text)
        const depths = tocDepths(found.map((entry) => entry.level))
        const next = found.map(({ heading, text }, i) => ({ heading, text, depth: depths[i] }))
        headings = next.map((entry) => entry.heading)
        setEntries((prev) => (isSameEntries(prev, next) ? prev : next))
      }
      if (needsScroller) {
        needsScroller = false
        scroller = findScroller(target)
      }
      const box = measureScroller(scroller)
      setRight(box.right)
      // サイドパネルはスライドして開く。transform の変化では scroll も ResizeObserver も起きないので、止まるまで測り直す
      if (box.right !== lastRight) {
        lastRight = box.right
        schedule()
      }

      const pinned = pinnedRef.current
      const pinnedIndex = pinned ? headings.indexOf(pinned.heading) : -1
      const next = pickCurrentHeading(
        headings.map((heading) => heading.getBoundingClientRect()),
        box,
        pinned && pinnedIndex >= 0 ? { index: pinnedIndex, scrollTop: pinned.scrollTop } : undefined,
      )
      if (next !== pinnedIndex) {
        pinnedRef.current = null
      }
      setCurrent(next)
    }
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(update)
      }
    }
    const scheduleWithScroller = () => {
      needsScroller = true
      schedule()
    }
    // MDXEditor は読み込み後に本文を組み立て、本文が変わると組み直すため、DOM の変化で見出しを取り直す
    const mutationObserver = new MutationObserver(() => {
      needsCollect = true
      scheduleWithScroller()
    })
    mutationObserver.observe(target, { childList: true, subtree: true, characterData: true })
    // 画像の読み込みなど、スクロールせずに見出しが動く場合。本文が伸びてサイドパネルがスクロールできるようになる場合もある
    const resizeObserver = new ResizeObserver(scheduleWithScroller)
    resizeObserver.observe(target)
    // scroll はバブリングしないので capture で拾う。本文を含むもの(window かサイドパネル)のスクロールだけを見る
    const onScroll = (e: Event) => {
      if (e.target === document || (e.target instanceof Node && e.target.contains(target))) {
        schedule()
      }
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', scheduleWithScroller)
    scheduleRef.current = schedule
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', scheduleWithScroller)
    }
  }, [targetRef])

  /** 見出しへスクロールし、その見出しを現在とする */
  const select = (heading: HTMLElement) => {
    heading.scrollIntoView({ block: 'start' })
    const target = targetRef.current
    pinnedRef.current = { heading, scrollTop: target ? measureScroller(findScroller(target)).scrollTop : 0 }
    // 既に先頭にあってスクロールが起きない場合も強調を移す
    scheduleRef.current()
  }

  return { entries, current, right, select }
}

const TocList: FC<{
  entries: Entry[]
  current: number
  listRef?: RefObject<HTMLOListElement | null>
  onSelect: (heading: HTMLElement) => void
}> = ({ entries, current, listRef, onSelect }) => {
  const style = tocStyle()
  return (
    <ol ref={listRef} className={style.list()}>
      {entries.map(({ heading, text, depth }, i) => {
        const itemStyle = tocStyle({ isCurrent: i === current })
        return (
          <li key={i} style={{ '--toc-depth': depth } as CSSProperties}>
            <button
              type='button'
              title={text}
              aria-current={i === current ? 'location' : undefined}
              className={itemStyle.button()}
              // クリックでフォーカスを残さない。残すとマウスを離しても一覧が閉じない
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                // Tab で入った後にマウスで押した場合も、残ったキーボードフォーカスで開いたままにしない
                const active = document.activeElement
                if (e.detail > 0 && active instanceof HTMLElement && e.currentTarget.closest('ol')?.contains(active)) {
                  active.blur()
                }
                onSelect(heading)
              }}
            >
              <span aria-hidden className={itemStyle.line()} />
              <span className={itemStyle.text()}>{text}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * 本文(targetRef の中の Markdown)の見出し h1〜h3 の目次。
 * 画面右端に見出しごとの線を並べ、ホバーで一覧に開く。タッチ端末では右下のボタンから一覧を開く。
 * スクロール位置に応じて現在の見出しを強調する
 */
export const MarkdownToc: FC<{ targetRef: RefObject<HTMLElement | null> }> = ({ targetRef }) => {
  const { t } = useLocale()
  const { entries, current, right, select } = useTocEntries(targetRef)
  const isHoverNone = useIsHoverNone()
  const [isPopoverOpen, setPopoverOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const label = t('table_of_contents')

  /** 一覧(ページではなく一覧自身)をスクロールして、現在の見出しを見せる */
  const revealCurrent = () => {
    const list = listRef.current
    const item = list?.children[current]
    if (!list || !(item instanceof HTMLElement)) {
      return
    }
    list.scrollTop = revealScrollTop({
      itemTop: item.offsetTop,
      itemHeight: item.offsetHeight,
      scrollTop: list.scrollTop,
      clientHeight: list.clientHeight,
    })
  }

  useEffect(() => {
    // 開いている間は動かさない。マウスの下で一覧がずれる
    if (!navRef.current?.matches(':hover')) {
      revealCurrent()
    }
  })

  if (entries.length === 0) {
    return null
  }

  const style = tocStyle()

  if (isHoverNone) {
    return (
      <div className='fixed bottom-4 z-20 print:hidden' style={{ right: right + 16 }}>
        <Popover isOpen={isPopoverOpen} onOpenChange={setPopoverOpen}>
          <MultiButton
            isIconOnly
            variant='secondary'
            aria-label={label}
            icon={<ListBulletIcon />}
            className='rounded-full shadow-lg'
          />
          <Popover.Content placement='top end' className='max-w-[min(320px,80vw)]'>
            <Popover.Dialog
              aria-label={label}
              // 開いた状態の見た目(toc-open)を常に当てる
              data-toc
              data-open
              className='flex max-h-[60vh] flex-col text-sm'
            >
              <div className={style.title()}>{label}</div>
              <TocList
                entries={entries}
                current={current}
                listRef={listRef}
                onSelect={(heading) => {
                  setPopoverOpen(false)
                  select(heading)
                }}
              />
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </div>
    )
  }

  return (
    <nav
      ref={navRef}
      data-toc
      aria-label={label}
      className={style.nav()}
      style={{ right }}
      // 閉じた線と開いた一覧で並びが変わるので、切り替わるたびに現在の見出しを見せ直す
      onPointerEnter={revealCurrent}
      onPointerLeave={revealCurrent}
      onFocus={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          revealCurrent()
        }
      }}
    >
      <div className={style.title()}>{label}</div>
      <TocList entries={entries} current={current} listRef={listRef} onSelect={select} />
    </nav>
  )
}
