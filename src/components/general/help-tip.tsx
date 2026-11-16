'use client'

import { FC, ReactNode } from 'react'
import { HoverPopover } from './hover-popover'
import { QuestionMarkCircleIcon } from './icons'
import { useGeneralUiText } from './ui-text'

/** 項目名の横に置く「?」アイコン。マウスを乗せるか押すと説明を出す */
export const HelpTip: FC<{
  /** 説明の対象(項目名)。読み上げ名に使う */
  label: string
  children: ReactNode
}> = ({ label, children }) => {
  const uiText = useGeneralUiText()
  return (
    <HoverPopover
      aria-label={uiText.fieldHelp(label)}
      triggerClassName='text-muted hover:text-foreground inline-flex items-center rounded-full'
      trigger={<QuestionMarkCircleIcon />}
      placement='top start'
      contentClassName='max-w-xs'
      dialogClassName='text-sm wrap-break-word'
    >
      {children}
    </HoverPopover>
  )
}
