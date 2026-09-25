'use client'

import { SideDrawer } from '@/components/general/drawer'
import { FlexCol } from '@/components/general/flex'
import { useLocale } from '@/locale/client'
import { cn } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { TicketDetailClient } from './[id]/client'
import { type BoardAssignee, type TicketFormOptions } from './use-ticket-form'

/**
 * 一覧(チケット / かんばん / エージェント)と、右から出るチケット詳細パネルの枠。
 *
 * 詳細パネルを開いている間は data-nav-hidden でサイドメニューを隠し、横幅を稼ぐ。
 * あわせて中央寄せ(mx-auto)をやめて左に寄せ、右のパネルと重なりにくくする。
 */
export const TicketDrawerLayout: FC<{
  selectedId: string | undefined
  onClose: () => void
  /** 詳細側で変更したときに一覧へ反映する */
  onChanged: () => void
  /** 一覧側で取得済みなら渡す(詳細パネルで取り直さない) */
  formOptions?: TicketFormOptions
  /** 一覧が 1 ボードに閉じている場合に、そのボードの担当者候補を渡す */
  boardAssignees?: BoardAssignee[]
  /** 最大幅などの枠の className */
  className?: string
  /**
   * md 以上で 1 画面に収める。高さの基準(画面高と padding)は data-fit-screen を見た
   * SideNavbar の #side-main 側が持つ
   */
  isFitScreen?: boolean
  children: ReactNode
}> = ({ selectedId, onClose, onChanged, formOptions, boardAssignees, className, isFitScreen, children }) => {
  const { t } = useLocale()
  return (
    <FlexCol
      data-wide
      data-fit-screen={isFitScreen ? '' : undefined}
      data-nav-hidden={selectedId ? '' : undefined}
      className={cn('max-w-6xl', className, !selectedId && 'mx-auto')}
    >
      {children}

      <SideDrawer
        isOpen={!!selectedId}
        aria-label={t('ticket')}
        onClose={onClose}
        className='bg-background border-l p-4 shadow-2xl'
      >
        {selectedId && (
          <TicketDetailClient
            // id が変わっても useActionData は再取得しないため、選択のたびに作り直す
            key={selectedId}
            id={selectedId}
            onClose={onClose}
            onChanged={onChanged}
            formOptions={formOptions}
            boardAssignees={boardAssignees}
          />
        )}
      </SideDrawer>
    </FlexCol>
  )
}
