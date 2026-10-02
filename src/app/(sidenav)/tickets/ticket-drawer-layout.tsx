'use client'

import { SideDrawer } from '@/components/general/drawer'
import { FlexCol } from '@/components/general/flex'
import { isBlankTarget } from '@/lib/client-utils'
import { useLocale } from '@/locale/client'
import { cn } from '@heroui/react'
import { FC, ReactNode, useEffect, useEffectEvent } from 'react'
import { TicketDetailClient } from './[id]/client'
import { type BoardAssignee, type TicketFormOptions } from './use-ticket-form'

/**
 * 一覧(チケット / かんばん / エージェント)と、右から出るチケット詳細パネルの枠。
 *
 * 詳細パネルを開いている間は data-nav-hidden でサイドメニューを隠し、横幅を稼ぐ。
 * あわせて中央寄せ(mx-auto)をやめて左に寄せ、右のパネルと重なりにくくする。
 * パネルを開いている間に一覧側の空白(操作できる要素の外)を押すと、選択を解除して閉じる。
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
  const close = useEffectEvent(() => onClose())

  /**
   * 一覧の下に残る余白など枠の外も対象にしたいので、document で受けて #side-main(メインコンテンツ)
   * の範囲で判定する。ポータルに出るモーダルやポップオーバーは #side-main の外なので対象にならない。
   *
   * 押下時点でも空白だったかを見るのは、カードをドラッグしてレーンの空白で離すと click が押下と離した
   * 要素の共通祖先で発火し、空白扱いになるため。リンクなどは preventParentSelection で伝播を
   * 止めているので、押下は capture で受ける。
   * 空白から文字列をドラッグで範囲選択したときも click が出るので、選択が残っていれば閉じない
   */
  useEffect(() => {
    const area = document.getElementById('side-main')
    if (!selectedId || !area) {
      return
    }
    let isBlankPress = false
    const onPointerDown = (e: PointerEvent) => {
      isBlankPress = isBlankTarget(e.target, area)
    }
    const onClick = (e: MouseEvent) => {
      const isSelectingText = window.getSelection()?.isCollapsed === false
      if (isBlankPress && !isSelectingText && !e.defaultPrevented && isBlankTarget(e.target, area)) {
        close()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick)
    }
  }, [selectedId])

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
