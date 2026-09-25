'use client'

import { FieldError, FieldLabel, TriggerClearButton } from '@/components/general/field'
import { useSmart } from '@/components/general/smart'
import { useLocale } from '@/locale/client'
import { EmptyState, ListBox, Select, Tooltip } from '@heroui/react'
import { FC } from 'react'
import { TagChip } from './ticket-chip'

import { NO_KEYS, type TagFieldBaseProps, type TagSelectOption } from './tag-id-select'

/**
 * タグ名で複数選択する Select(絞り込み条件用)。react-hook-form には依存しない。
 *
 * `TagIdSelectField`(tag-id-select.tsx)との違い:
 * - 値が **タグ名の配列**(tagId ではない)。ボード横断でも同名タグを 1 条件に畳むため
 * - 検索入力 / 新規作成を持たないので Autocomplete ではなく Select で構成する
 *
 * collection のキーもタグ名にするため、`options` は呼び出し側で
 * `dedupeTagOptionsByName`(lib/board/tag-rule.ts) を通して同名を畳んでおくこと。
 */
export const TagNameSelectField: FC<
  TagFieldBaseProps & {
    options: TagSelectOption[]
    /** 選択中のタグ名 */
    value: string[]
    onChange: (value: string[]) => void
    /** 選択できる最大件数。到達したら未選択のタグを選べなくする */
    max?: number
    variant?: 'primary' | 'secondary'
    /** 指定時、非活性でもマウスオーバーで理由を表示する */
    tooltip?: string
  }
> = ({
  options,
  value,
  onChange,
  label,
  isLabelHidden,
  max,
  variant,
  errorMessage,
  isSmart: isSmartProp,
  isSmartForm: isSmartFormProp,
  isDisabled,
  tooltip,
}) => {
  const { isCompact, hasErrorArea } = useSmart(isSmartProp, isSmartFormProp)
  const { t } = useLocale()
  // 選択順で並べる(options 順ではなく選んだ順にチップが増える)。
  // options は dedupeTagOptionsByName 済みなので名前は一意
  const selected = value.flatMap((name) => options.find((tag) => tag.name === name) ?? [])
  const isFull = max !== undefined && value.length >= max
  // 上限に達したら未選択のタグだけ選べなくする。
  // 選択済みも無効にすると disabledBehavior='all' により press が届かず解除もできなくなる。
  const disabledKeys = isFull ? options.filter((tag) => !value.includes(tag.name)).map((tag) => tag.name) : NO_KEYS

  const select = (
    <Select
      selectionMode='multiple'
      value={value}
      variant={variant}
      isInvalid={!!errorMessage}
      isDisabled={isDisabled}
      disabledKeys={disabledKeys}
      // タグが 0 件でも開けるようにする(react-aria は collection が空だと開かない)
      allowsEmptyCollection
      onChange={(keys) => onChange(keys.map(String))}
    >
      <FieldLabel isCompact={isCompact} isHidden={isLabelHidden}>
        {label ?? t('tags')}
        {max !== undefined && <span className='ml-1 text-xs opacity-60'>{`${value.length}/${max}`}</span>}
      </FieldLabel>
      <Select.Trigger // isCompact: 既定 36px を 28px に詰める
        className={isCompact ? 'min-h-7 py-1' : undefined}
      >
        <Select.Value className='flex flex-wrap items-center gap-1'>
          {() =>
            selected.length > 0 ? (
              <>
                {selected.map((tag) => (
                  <TagChip key={tag.id} tag={tag} />
                ))}
              </>
            ) : (
              <span className='opacity-60'>{t('no_tag_selected')}</span>
            )
          }
        </Select.Value>
        {value.length > 0 && !isDisabled && (
          // Select には Autocomplete.ClearButton 相当が無い
          <TriggerClearButton className='ml-auto' onClear={() => onChange([])} />
        )}
        <Select.Indicator />
      </Select.Trigger>
      <FieldError hasErrorArea={hasErrorArea}>{errorMessage}</FieldError>
      <Select.Popover>
        <ListBox selectionMode='multiple' renderEmptyState={() => <EmptyState>{t('msg_no_tags')}</EmptyState>}>
          {options.map((tag) => (
            // キーは tagId ではなく名前(value と揃える)
            <ListBox.Item key={tag.name} id={tag.name} textValue={tag.name} className='min-h-min py-1'>
              <TagChip tag={{ ...tag, name: '　' }} />
              {tag.name}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )

  return tooltip ? (
    <Tooltip delay={300}>
      {/* isDisabled な Select はホバー系のイベントを自ら拾わなくなるため、Trigger 側でホバーを検知させる */}
      <Tooltip.Trigger className='block'>{select}</Tooltip.Trigger>
      <Tooltip.Content showArrow>{tooltip}</Tooltip.Content>
    </Tooltip>
  ) : (
    select
  )
}
