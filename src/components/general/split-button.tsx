'use client'

import { ChevronUpIcon } from '@/components/icon'
import { ButtonProps, cn, Dropdown } from '@heroui/react'
import { ReactNode } from 'react'
import { MultiButton } from './button'

export type SplitButtonOption<T extends string> = {
  id: T
  /** ドロップダウン内の選択肢ラベル */
  menuLabel: ReactNode
  /** 選択中にメインボタンへ表示するラベル */
  actionLabel: ReactNode
}

/**
 * 「選択肢を選ぶドロップダウン」+「選択中の内容で実行するボタン」を1つにまとめた split button。
 * メインボタンのラベルは選択中の選択肢の `actionLabel` に追従する。
 */
export const SplitButton = <T extends string>({
  options,
  selectedId,
  onSelectChange,
  onPress,
  icon,
  isDisabled,
  isPending,
  size,
  className,
  dropdownLabel,
}: {
  options: SplitButtonOption<T>[]
  selectedId: T
  onSelectChange: (id: T) => void
  onPress: () => void
  icon?: ReactNode
  isDisabled?: boolean
  isPending?: boolean
  size?: ButtonProps['size']
  className?: string
  /** ドロップダウンを開くボタンの読み上げ用ラベル(見た目には出ない) */
  dropdownLabel: string
}) => {
  const selected = options.find((option) => option.id === selectedId) ?? options[0]

  return (
    // HeroUI の `ButtonGroup` はプライマリボタン/矢印ボタン共に「直接の子」が Button であることを前提に
    // context を流し込む(`Dropdown` を直接の子にすると内部フラグが Dropdown 経由で DOM まで漏れて警告になる)。
    // 見た目の連結(角丸・区切り)は `.button-group` 側の構造的な CSS だけで決まるので、
    // ButtonGroup 本体は使わず同じクラス名を持つ素の div で代用する。
    <div className={cn('button-group button-group--horizontal', className)}>
      <MultiButton size={size} icon={icon} isPending={isPending} isDisabled={isDisabled} onPress={onPress}>
        {selected.actionLabel}
      </MultiButton>
      <Dropdown>
        {/* MultiButton にするのは、隣のプライマリボタンと同じ isSmart コンテキストから高さを揃えるため */}
        <MultiButton isIconOnly size={size} isDisabled={isDisabled} aria-label={dropdownLabel}>
          <ChevronUpIcon width={16} className='rotate-180' />
        </MultiButton>
        <Dropdown.Popover>
          <Dropdown.Menu
            disallowEmptySelection
            selectionMode='single'
            selectedKeys={[selectedId]}
            onAction={(key) => onSelectChange(key as T)}
          >
            {options.map((option) => (
              // 既定の menu-item は縦に間延びするので、SingleSelectField の ListBox.Item と同じ詰め方にする
              <Dropdown.Item
                key={option.id}
                id={option.id}
                textValue={String(option.menuLabel)}
                className='min-h-min py-1'
              >
                <Dropdown.ItemIndicator />
                {option.menuLabel}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  )
}
