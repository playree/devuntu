'use client'

import { cn } from '@heroui/react'
import { FC, KeyboardEvent, PointerEvent, useRef } from 'react'
import {
  clampSideNavWidth,
  SIDE_NAV_WIDTH_DEFAULT,
  SIDE_NAV_WIDTH_MAX,
  SIDE_NAV_WIDTH_MIN,
  SIDE_NAV_WIDTH_STEP,
} from './side-nav-width'
import { useGeneralUiText } from './ui-text'

/**
 * サイドメニューの右端に置く幅変更のハンドル(lg 以上のみ表示。メニューを隠している間は出さない)。
 * ドラッグ中は `onPreview` で見た目だけを追従させ(メニューを描画し直さない)、離したときに `onCommit` で確定する。
 * キーボードは ←/→ で `SIDE_NAV_WIDTH_STEP` ずつ、Home / End で最小 / 最大。ダブルクリックで既定の幅に戻す
 */
export const SideNavResizer: FC<{
  /** 確定済みの幅 */
  width: number
  onPreview: (width: number) => void
  /** 幅が変わったときだけ呼ぶ */
  onCommit: (width: number) => void
  onResizingChange: (isResizing: boolean) => void
}> = ({ width, onPreview, onCommit, onResizingChange }) => {
  const { sideNavResize } = useGeneralUiText()
  const drag = useRef<{ startX: number; startWidth: number; current: number } | null>(null)

  const commit = (next: number) => {
    if (next !== width) {
      onCommit(next)
    }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return
    }
    // ポインターを捕まえて、メニューの外へ出ても追従させる。既定の動作(文字列の範囲選択)は止める
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
    drag.current = { startX: e.clientX, startWidth: width, current: width }
    onResizingChange(true)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      drag.current.current = clampSideNavWidth(drag.current.startWidth + e.clientX - drag.current.startX)
      onPreview(drag.current.current)
    }
  }

  // pointerup が来ないままキャプチャを失った(フォーカスが外れた等)ときも、最後の幅で終える
  const onPointerEnd = () => {
    if (!drag.current) {
      return
    }
    const next = drag.current.current
    drag.current = null
    onResizingChange(false)
    commit(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = {
      ArrowLeft: width - SIDE_NAV_WIDTH_STEP,
      ArrowRight: width + SIDE_NAV_WIDTH_STEP,
      Home: SIDE_NAV_WIDTH_MIN,
      End: SIDE_NAV_WIDTH_MAX,
    }[e.key]
    if (next !== undefined) {
      e.preventDefault()
      commit(clampSideNavWidth(next))
    }
  }

  return (
    <div
      role='separator'
      aria-orientation='vertical'
      aria-label={sideNavResize}
      aria-valuemin={SIDE_NAV_WIDTH_MIN}
      aria-valuemax={SIDE_NAV_WIDTH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      className={cn(
        // 見た目の線は細く、掴める範囲は広く取る。メニューと一緒に画面外へ隠れるよう、はみ出さない位置に置く
        'absolute inset-y-0 right-0 z-10 hidden w-2 cursor-col-resize touch-none outline-none lg:block',
        // チケット詳細パネルなどでメニューを隠している間は、掴めず・フォーカスも受けないようにする
        'lg:group-has-data-nav-hidden/sidenav:hidden',
        "after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:content-['']",
        'hover:after:bg-accent/60 focus-visible:after:bg-accent active:after:bg-accent after:transition-colors',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onKeyDown={onKeyDown}
      onDoubleClick={() => commit(SIDE_NAV_WIDTH_DEFAULT)}
    />
  )
}
