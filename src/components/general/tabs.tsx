'use client'

import { Tabs } from '@heroui/react'
import { FC, Key, ReactNode } from 'react'
import { tv } from 'tailwind-variants'

// 既定の左右パディングはタブ外に並ぶ要素と左端が揃わないので打ち消す
const panelStyles = tv({ base: 'px-0' })

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
}> = ({
  items,
  'aria-label': ariaLabel,
  variant,
  className,
  panelClassName,
  selectedKey,
  onSelectionChange,
  forceMount,
}) => (
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
    {items.map((item) => (
      <Tabs.Panel
        key={item.id}
        id={item.id}
        shouldForceMount={forceMount}
        className={panelStyles({ className: [panelClassName, forceMount && 'data-inert:hidden'] })}
      >
        {item.content}
      </Tabs.Panel>
    ))}
  </Tabs>
)
