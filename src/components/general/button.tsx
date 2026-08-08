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
      className={cn(isSmart ? 'h-fit px-2 py-0.5' : '', className)}
      {...props}
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
