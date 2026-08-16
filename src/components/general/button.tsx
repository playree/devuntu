'use client'

import { Button, ButtonProps, cn, Spinner, Tooltip } from '@heroui/react'
import { FC, ReactNode, useEffect, useState } from 'react'
import { useIsSmart } from './smart'

export const MultiButton: FC<
  ButtonProps & {
    className?: string
    icon?: ReactNode
    tooltip?: string
    isSmart?: boolean
    isLink?: boolean
    coolTime?: number
  }
> = ({
  children,
  type = 'button',
  size,
  onPress,
  isPending,
  tooltip,
  isSmart: isSmartProp,
  className,
  icon,
  coolTime = 0,
  isDisabled,
  ...props
}) => {
  /**
   * tooltip から react-aria が付けるのは aria-describedby(しかも表示中のみ)で読み上げ名にはならない。
   * アイコンは aria-hidden なので、isIconOnly のときは tooltip を名前として使う
   */
  const ariaLabel = props['aria-label'] ?? (props.isIconOnly ? tooltip : undefined)
  const isSmart = useIsSmart(isSmartProp)
  const [waitTime, setWaitTime] = useState(0)

  useEffect(() => {
    if (waitTime > 0) {
      const timer = setTimeout(() => {
        setWaitTime((prev) => prev - 1)
      }, 1000)

      return () => clearTimeout(timer)
    }
  }, [waitTime])

  const button = (
    <Button
      type={type}
      size={size}
      // isPending でアイコンがスピナーへ入れ替わっても高さが動かないよう、中身依存にせず固定する
      className={cn(isSmart ? 'h-7 px-2' : '', className)}
      {...props}
      aria-label={ariaLabel}
      onPress={(e) => {
        if (onPress) {
          onPress(e)
        }
        if (coolTime > 0) {
          setWaitTime(coolTime)
        }
      }}
      isPending={isPending}
      isDisabled={waitTime > 0 ? true : isDisabled}
    >
      {isPending ? <Spinner color='current' size='sm' className='-mx-0.5' /> : icon}
      <>{waitTime > 0 ? `wait ${waitTime}s` : children}</>
    </Button>
  )

  return tooltip ? (
    <Tooltip delay={300}>
      {button}
      <Tooltip.Content showArrow>{tooltip}</Tooltip.Content>
    </Tooltip>
  ) : (
    button
  )
}
