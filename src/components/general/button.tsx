'use client'

import { Button, ButtonProps, Link, Tooltip } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'
import { twMerge } from 'tailwind-merge'

export const MultiButton: FC<
  ButtonProps & {
    tooltip?: string
    isSmart?: boolean
    isLink?: boolean
    showAnchorIcon?: boolean
    isExternal?: boolean
    isSecondary?: boolean
    coolTime?: number
  }
> = ({
  children,
  type = 'button',
  size,
  color = 'primary',
  variant = 'flat',
  onPress,
  href = '',
  tooltip,
  isSmart,
  isLink,
  className,
  startContent,
  isLoading,
  isSecondary,
  coolTime = 0,
  isDisabled,
  ...props
}) => {
  const router = useRouter()
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
      color={isSecondary ? 'secondary' : color}
      variant={isSecondary ? 'light' : variant}
      className={twMerge(isSmart ? 'h-fit px-2 py-1' : '', className)}
      {...props}
      onPress={
        href && !isLink
          ? () => {
              router.push(href)
            }
          : (e) => {
              if (onPress) {
                onPress(e)
              }
              if (coolTime > 0) {
                setWaitTime(coolTime)
              }
            }
      }
      as={isLink ? Link : undefined}
      href={isLink ? href : undefined}
      startContent={isLoading ? undefined : startContent}
      isLoading={isLoading}
      isDisabled={waitTime > 0 ? true : isDisabled}
    >
      {waitTime > 0 ? `wait ${waitTime}s` : children}
    </Button>
  )

  return tooltip ? (
    <Tooltip color={color} showArrow content={tooltip}>
      {button}
    </Tooltip>
  ) : (
    button
  )
}
