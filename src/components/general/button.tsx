'use client'

import { Button, ButtonProps, cn, Spinner, Tooltip } from '@heroui/react'
import { FC, ReactNode, useEffect, useState } from 'react'
import { CheckIcon } from './icons'
import { useIsSmart } from './smart'
import { useGeneralUiText } from './ui-text'

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
  const uiText = useGeneralUiText()
  const [waitTime, setWaitTime] = useState(0)
  // アイコンのみのボタンはクールタイム中に残り秒数だけを出すため、アイコンは隠す
  const isIconHidden = waitTime > 0 && !!props.isIconOnly

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
      {isPending ? <Spinner color='current' size='sm' className='-mx-0.5' /> : isIconHidden ? null : icon}
      <>
        {waitTime > 0 ? (props.isIconOnly ? (isPending ? '' : `${waitTime}`) : uiText.waitSeconds(waitTime)) : children}
      </>
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

export type SubmitButtonsProps = {
  /** 省略時は OK */
  label?: string
  /** 省略時は CheckIcon */
  icon?: ReactNode
  isPending?: boolean
  isDisabled?: boolean
  size?: ButtonProps['size']
  /** 省略時は form の submit になる */
  onPress?: () => void
  /** 省略時はモーダルを閉じる(slot='close') */
  onCancel?: () => void
}

/** キャンセルと確定のボタンの組。処理中はキャンセルも押させない */
export const SubmitButtons: FC<SubmitButtonsProps> = ({
  label,
  icon,
  isPending,
  isDisabled,
  size,
  onPress,
  onCancel,
}) => {
  const uiText = useGeneralUiText()
  return (
    <>
      <MultiButton
        variant='ghost'
        size={size}
        isDisabled={isPending}
        {...(onCancel ? { onPress: onCancel } : { slot: 'close' })}
      >
        {uiText.cancel}
      </MultiButton>
      <MultiButton
        type={onPress ? 'button' : 'submit'}
        size={size}
        icon={icon ?? <CheckIcon />}
        isPending={isPending}
        isDisabled={isDisabled}
        onPress={onPress}
      >
        {label ?? uiText.ok}
      </MultiButton>
    </>
  )
}
