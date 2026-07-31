'use client'

import { cn, Tag, TagGroup } from '@heroui/react'
import { useMemo } from 'react'
import { useIsSmart } from './smart'

/** MultiTagField の選択肢 1 件 */
export type MultiTagItem<T extends string = string> = { id: T; label: string; isDisabled?: boolean }

/**
 * クリック / キーボードで ON/OFF する複数選択タグ群。絞り込み条件の指定などに使う。
 * 値は選択肢の ID の配列。value / onChange を渡して外部stateで制御する。
 */
export const MultiTagField = <T extends string>({
  label,
  items,
  value,
  onChange,
  size = 'sm',
  variant,
  isSmart: isSmartProp,
  ariaLabel,
}: {
  label: string
  items: readonly MultiTagItem<T>[]
  value: readonly T[]
  onChange: (value: T[]) => void
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'surface'
  isSmart?: boolean
  ariaLabel?: string
}) => {
  const isSmart = useIsSmart(isSmartProp)
  // react-aria へ毎回新しい Set を渡さないよう value 参照で memo 化する
  const selectedKeys = useMemo(() => new Set<string>(value), [value])
  return (
    <TagGroup
      aria-label={ariaLabel || `aria-${label}`}
      selectionMode='multiple'
      selectedKeys={selectedKeys}
      // 絞り込み条件が Escape で意図せず全解除されるのを防ぐ(react-aria の既定は clearSelection)
      escapeKeyBehavior='none'
      size={size}
      variant={variant}
      // items から組み立てることで戻り値を T[] に型付けし、かつ items の並び順を保つ
      onSelectionChange={(keys) =>
        onChange(
          keys === 'all'
            ? items.map((item) => item.id)
            : items.filter((item) => keys.has(item.id)).map((item) => item.id),
        )
      }
    >
      {/* items prop は使わず静的に children を map する(react-aria のコレクションキャッシュを避ける) */}
      <fieldset className='rounded-xl border-2 px-2 pt-0.5 pb-1.5'>
        <legend className={cn('text-foreground px-2', isSmart ? 'text-xs font-light' : '')}>{label}</legend>
        <TagGroup.List>
          {items.map((item) => (
            <Tag key={item.id} id={item.id} textValue={item.label} isDisabled={item.isDisabled}>
              {item.label}
            </Tag>
          ))}
        </TagGroup.List>
      </fieldset>
    </TagGroup>
  )
}
