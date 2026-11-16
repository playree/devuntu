'use client'

import { cn, Popover, PopoverContentProps, popoverVariants } from '@heroui/react'
import { FC, PointerEvent, ReactNode, useEffect, useRef, useState } from 'react'

/** 閉じた状態 / マウスを乗せて開いた状態 / 押して開いた状態 */
type OpenMode = 'closed' | 'hover' | 'press'

const HOVER_OPEN_DELAY = 300
const HOVER_CLOSE_DELAY = 150

/**
 * マウスを乗せても押しても開く Popover。
 * Tooltip はタップで開けずスマホで中身を見られないため、補足を出すトリガーにはこちらを使う。
 * マウスで開いたときは外へ出れば閉じるよう非モーダルにし、押して開いたときは外側のタップで閉じられるようモーダルにする。
 */
export const HoverPopover: FC<{
  /** トリガーの中身 */
  trigger: ReactNode
  triggerClassName?: string
  'aria-label': string
  placement?: PopoverContentProps['placement']
  contentClassName?: string
  /** ポップオーバー側の読み上げ名。省略時はトリガーと同じ */
  dialogAriaLabel?: string
  dialogClassName?: string
  /** ポップオーバーの中身 */
  children: ReactNode
}> = ({
  trigger,
  triggerClassName,
  'aria-label': ariaLabel,
  placement,
  contentClassName,
  dialogAriaLabel,
  dialogClassName,
  children,
}) => {
  const [mode, setMode] = useState<OpenMode>('closed')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const isPressing = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])

  const schedule = (next: (current: OpenMode) => OpenMode, delay: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMode(next), delay)
  }
  const hoverHandlers = {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        schedule((current) => (current === 'closed' ? 'hover' : current), HOVER_OPEN_DELAY)
      }
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        schedule((current) => (current === 'hover' ? 'closed' : current), HOVER_CLOSE_DELAY)
      }
    },
  }

  const onOpenChange = (isOpen: boolean) => {
    clearTimeout(timer.current)
    // マウスで開いている最中のクリックは閉じずに押して開いた状態へ切り替える
    setMode(isOpen || (mode === 'hover' && isPressing.current) ? 'press' : 'closed')
    isPressing.current = false
  }

  return (
    <Popover isOpen={mode !== 'closed'} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label={ariaLabel}
        className={cn('cursor-pointer', triggerClassName)}
        onPointerDown={() => (isPressing.current = true)}
        {...hoverHandlers}
      >
        {trigger}
      </Popover.Trigger>
      <Popover.Content
        isNonModal={mode === 'hover'}
        placement={placement ?? 'bottom start'}
        className={contentClassName}
        {...hoverHandlers}
      >
        {mode === 'hover' ? (
          <div // Dialog はマウント時にフォーカスを奪うため、マウスで開いたときは入力中の欄からフォーカスを動かさない素の要素で出す
            data-slot='popover-dialog'
            className={popoverVariants().dialog({ className: dialogClassName })}
          >
            {children}
          </div>
        ) : (
          <Popover.Dialog aria-label={dialogAriaLabel ?? ariaLabel} className={dialogClassName}>
            {children}
          </Popover.Dialog>
        )}
      </Popover.Content>
    </Popover>
  )
}
