'use client'

import { Button, ButtonProps, Link, Tooltip } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { twMerge } from 'tailwind-merge'

export const MultiButton: FC<
  ButtonProps & {
    tooltip?: string
    isSmart?: boolean
    isLink?: boolean
    showAnchorIcon?: boolean
    isExternal?: boolean
    isSecondary?: boolean
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
  ...props
}) => {
  const router = useRouter()
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
          : onPress
      }
      as={isLink ? Link : undefined}
      href={isLink ? href : undefined}
      startContent={isLoading ? undefined : startContent}
      isLoading={isLoading}
    >
      {children}
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
