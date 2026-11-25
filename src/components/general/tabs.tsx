'use client'

import { Tabs } from '@heroui/react'
import { FC, Key, ReactNode } from 'react'
import { tv } from 'tailwind-variants'

const panelStyles = tv({
  // 既定の左右パディングはタブ外に並ぶ要素と左端が揃わないので打ち消す
  base: 'px-0',
  variants: {
    slide: {
      // 帯に並べるので、横向きタブの既定の上余白(mt-4)ははみ出しになる
      true: 'mt-0! h-full w-full shrink-0',
    },
  },
})

const slideTrackStyles = tv({
  base: 'flex h-full transition-transform duration-300 ease-out motion-reduce:transition-none',
})

/** TabsBox のタブ1件 */
export type TabBoxItem = {
  id: string
  label: ReactNode
  content: ReactNode
}

/**
 * タブ切り替え。
 * ListContainer / List / Tab / Indicator / Panel の入れ子を隠し、items だけで書けるようにする。
 * タブと中身は items で1件にまとめ、`id` の付け違いが起きないようにする。
 */
export const TabsBox: FC<{
  items: readonly TabBoxItem[]
  /** タブリストの読み上げ名 */
  'aria-label': string
  /** secondary はピルではなくアンダーライン表示になる */
  variant?: 'primary' | 'secondary'
  className?: string
  /** 中身の className(パディングやレイアウトの調整用) */
  panelClassName?: string
  /** 選択中のタブを外から制御するときに渡す */
  selectedKey?: string
  onSelectionChange?: (key: string) => void
  /**
   * 選んでいないタブの中身も描画したままにする(切り替えで状態を失わせたくないとき)。
   * 選んでいないパネルには data-inert が付くので、その間は隠す(祖先が inert のとき(モーダル表示中など)は隠さない)
   */
  forceMount?: boolean
  /**
   * 中身を横に並べ、切り替えをスライドで見せる。selectedKey で制御するときだけ使える。
   * 全パネルを描画したままにし(forceMount 相当)、各パネルが自分でスクロールする
   */
  slide?: boolean
}> = ({
  items,
  'aria-label': ariaLabel,
  variant,
  className,
  panelClassName,
  selectedKey,
  onSelectionChange,
  forceMount,
  slide,
}) => {
  const panels = items.map((item) => (
    <Tabs.Panel
      key={item.id}
      id={item.id}
      shouldForceMount={slide || forceMount}
      className={panelStyles({ slide, className: [panelClassName, !slide && forceMount && 'data-inert:hidden'] })}
    >
      {item.content}
    </Tabs.Panel>
  ))
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selectedKey),
  )

  return (
    <Tabs
      variant={variant}
      className={className}
      selectedKey={selectedKey}
      onSelectionChange={onSelectionChange && ((key: Key) => onSelectionChange(String(key)))}
    >
      <Tabs.ListContainer // variant のスタイルはこのコンテナに当たるので、省くと下線もインジケータも出ない
      >
        <Tabs.List aria-label={ariaLabel}>
          {items.map((item) => (
            <Tabs.Tab key={item.id} id={item.id}>
              {item.label}
              <Tabs.Indicator // 選択中のタブへ移動するので、タブ1件ごとに置く
              />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
      {slide ? (
        <div className='min-h-0 flex-1 overflow-hidden'>
          <div className={slideTrackStyles()} style={{ transform: `translateX(-${selectedIndex * 100}%)` }}>
            {panels}
          </div>
        </div>
      ) : (
        panels
      )}
    </Tabs>
  )
}
