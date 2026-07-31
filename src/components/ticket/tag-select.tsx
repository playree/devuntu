'use client'

import { MultiButton } from '@/components/general/button'
import { XCircleIcon } from '@/components/general/select'
import { useIsSmart } from '@/components/general/smart'
import { PlusIcon, XMarkIcon } from '@/components/icon'
import type { TagColor } from '@/generated/prisma/enums'
import { MAX_TAG_NAME, MAX_TICKET_TAGS } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { Autocomplete, EmptyState, ErrorMessage, Label, ListBox, SearchField, Select, useFilter } from '@heroui/react'
import { FC, useState } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { TagChip } from './ticket-chip'

/** 選択肢として渡すタグ。`lib/tag.ts` の TagOption と構造的に一致させる */
export type TagSelectOption = { id: string; name: string; color: TagColor }

/** react-aria へ毎回新しい配列を渡さないよう空配列は使い回す */
const NO_KEYS: string[] = []

/**
 * チケットのタグ選択(一覧から複数選択 + 入力で絞り込み + 入力値をそのまま新規作成)。
 *
 * HeroUI の Autocomplete(react-aria の Select + Autocomplete)で構成する。
 * - トリガーに選択済みタグを Chip で並べ、× で個別解除 / ClearButton で全解除
 * - ポップオーバー内の SearchField で候補を絞り込む(ListBox は複数選択)
 * - 一致するタグが無ければ「『xxx』を作成」ボタンを出し、クリック or Enter で onCreate を呼ぶ
 *
 * Enter の扱いは `disableAutoFocusFirst` が前提。これを外すと react-aria が
 * 入力ごとに先頭候補へ仮想フォーカスを乗せてしまい「入力値をそのまま追加」ができない。
 * さらにその挙動は inputType が insertText のときだけなので、IME 経由の日本語入力では
 * 仮想フォーカスが乗らず Enter が無反応になる。付けることで
 * 「入力して Enter = 作成 / ArrowDown で候補へ移ってから Enter = 選択」に固定できる。
 *
 * フォームの値は tagId の配列。`options` には**対象ボードのタグだけ**を渡すこと
 * (他ボードのタグを選べてしまうとサーバー側の assertTagIdsInBoard で弾かれる)。
 *
 * 新規作成の Server Action は呼び出し側がクロージャで注入する
 * (`components/` から page 配下の server.ts を直接 import しないため)。
 * 作成権限が無い場合は `onCreate` を渡さないこと。
 */
export const TagSelect = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  options,
  onCreate,
  label,
  errorMessage,
  variant,
  isSmart: isSmartProp,
}: {
  control: Control<TFieldValues>
  name: TName
  options: TagSelectOption[]
  /** 作成したタグを返す。同名が既にある場合は既存を返してもよい */
  onCreate?: (name: string) => Promise<TagSelectOption | undefined>
  label?: string
  errorMessage?: string
  variant?: 'primary' | 'secondary'
  isSmart?: boolean
}) => {
  const isSmart = useIsSmart(isSmartProp)
  const { t } = useLocale()
  // 大文字小文字やアクセントの違いを無視して絞り込む
  const { contains } = useFilter({ sensitivity: 'base' })
  const [draft, setDraft] = useState('')
  const [isCreating, setCreating] = useState(false)
  // onCreate で作られたタグは options の再取得を待たずに選べるようにする。
  // collection に無い tagId は selectedItems から落ちてしまうため、ここへの保持は必須。
  const [created, setCreated] = useState<TagSelectOption[]>([])

  const all = [...options, ...created.filter((tag) => !options.some((o) => o.id === tag.id))]
  const keyword = draft.trim()

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => {
        const selectedIds: string[] = Array.isArray(value) ? value : NO_KEYS
        const selected = selectedIds.flatMap((id) => all.filter((tag) => tag.id === id))
        const isFull = selectedIds.length >= MAX_TICKET_TAGS
        // 上限に達したら未選択のタグだけ選べなくする。
        // 選択済みも無効にすると disabledBehavior='all' により press が届かず解除もできなくなる。
        const disabledKeys = isFull ? all.filter((tag) => !selectedIds.includes(tag.id)).map((tag) => tag.id) : NO_KEYS
        // 同名が既にあるときは作成ボタンを出さない(既存を選ばせる)
        const canCreate = !!onCreate && !isFull && keyword !== '' && !all.some((tag) => tag.name === keyword)

        const add = (id: string) => {
          if (selectedIds.includes(id)) {
            return
          }
          onChange([...selectedIds, id])
        }

        /**
         * 入力値を確定する。同名が既にあれば選択するだけ、無ければ onCreate で作成する。
         * ListBox の外に置いた作成ボタンと、検索入力の Enter から呼ぶ。
         */
        const commitDraft = async () => {
          if (keyword === '' || isFull || isCreating) {
            return
          }
          const existing = all.find((tag) => tag.name === keyword)
          if (existing) {
            add(existing.id)
            setDraft('')
            return
          }
          if (!onCreate) {
            return
          }
          setCreating(true)
          try {
            const tag = await onCreate(keyword)
            if (tag) {
              setCreated((prev) => (prev.some((p) => p.id === tag.id) ? prev : [...prev, tag]))
              add(tag.id)
              // 作成後は絞り込みを解除して一覧を戻す
              setDraft('')
            }
          } finally {
            setCreating(false)
          }
        }

        return (
          <Autocomplete
            selectionMode='multiple'
            variant={variant}
            value={selectedIds}
            isInvalid={!!errorMessage}
            disabledKeys={disabledKeys}
            // タグが 0 件でも開けるようにする(react-aria は collection が空だと開かない)
            allowsEmptyCollection
            onChange={(keys) => onChange(keys.map(String))}
            onOpenChange={(isOpen) => {
              // 閉じたら絞り込みを捨てる(次に開いたとき前回の入力が残らないように)
              if (!isOpen) {
                setDraft('')
              }
            }}
            onBlur={onBlur}
            ref={ref}
          >
            <Label className={isSmart ? 'text-xs font-light' : ''}>
              {label ?? t('tags')}
              <span className='ml-1 text-xs opacity-60'>{`${selectedIds.length}/${MAX_TICKET_TAGS}`}</span>
            </Label>
            {/* isSmart: 既定 36px(min-h-9 + py-2)を 28px へ。text-sm の行高 20px + 上下 4px */}
            <Autocomplete.Trigger className={isSmart ? 'min-h-7 py-1' : undefined}>
              <Autocomplete.Value className='flex flex-wrap items-center gap-1'>
                {() =>
                  selected.length > 0 ? (
                    <>
                      {selected.map((tag) => (
                        <TagChip key={tag.id} tag={tag}>
                          <span
                            role='button'
                            aria-label={`remove ${tag.name}`}
                            tabIndex={-1}
                            className='ml-1 inline-flex cursor-pointer items-center opacity-60 hover:opacity-100'
                            // トリガーの onClick は開閉なので × では伝播を止める
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              onChange(selectedIds.filter((id) => id !== tag.id))
                            }}
                          >
                            <XMarkIcon width={14} />
                          </span>
                        </TagChip>
                      ))}
                    </>
                  ) : (
                    <span className='opacity-60'>{t('no_tag_selected')}</span>
                  )
                }
              </Autocomplete.Value>
              {/* 全解除。未選択(data-empty)のときは CSS 側で非表示になる */}
              <Autocomplete.ClearButton />
              {/* children を渡すと Button ラップが消えてキーボードで開けなくなるので空のまま */}
              <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
            {/*
              aria-label は内部の Dialog 用。HeroUI 3.2.2 の Autocomplete.Popover は Dialog へ
              ラベルを渡さず react-aria が警告を出すため、patches/@heroui__react.patch で転送している。
              Select のコレクション構築は children を <template> 内で描画するので、
              <Heading slot='title'> では(id が実 DOM に無く)ラベル付けできない。
            */}
            <Autocomplete.Popover aria-label={label ?? t('tags')}>
              <Autocomplete.Filter
                inputValue={draft}
                onInputChange={setDraft}
                filter={contains}
                // 入力しただけでは候補へ仮想フォーカスを乗せない(Enter を作成に使うため)
                disableAutoFocusFirst
              >
                <SearchField aria-label={t('search_tag')}>
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input
                      autoFocus
                      placeholder={t('search_tag')}
                      maxLength={MAX_TAG_NAME}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || e.nativeEvent.isComposing) {
                          return
                        }
                        // react-aria が候補を選択済みなら preventDefault されているので何もしない
                        if (e.isDefaultPrevented()) {
                          return
                        }
                        // フォーム submit の保険(検索入力は portal 内なので本来届かない)
                        e.preventDefault()
                        void commitDraft()
                      }}
                    />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                {canCreate && (
                  // SearchField の px-3 に合わせる(ポップオーバー自体は p-0)
                  <div className='px-3 pb-1'>
                    <MultiButton
                      variant='ghost'
                      size='sm'
                      className='w-full justify-start'
                      icon={<PlusIcon width={16} />}
                      isPending={isCreating}
                      onPress={() => void commitDraft()}
                      // フィールドが isSmart でもポップオーバー内は通常サイズを保つ
                      isSmart={false}
                    >
                      {t('create_tag', { name: keyword })}
                    </MultiButton>
                  </div>
                )}
                <ListBox
                  selectionMode='multiple'
                  // useSelect が autoFocus を強制するため、開いた直後の Enter で先頭タグが解除されるのを防ぐ
                  autoFocus={false}
                  renderEmptyState={() => (
                    <EmptyState>{all.length === 0 ? t('msg_no_tags') : t('msg_no_matching_tags')}</EmptyState>
                  )}
                >
                  {all.map((tag) => (
                    <ListBox.Item key={tag.id} id={tag.id} textValue={tag.name}>
                      <TagChip tag={tag} />
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Autocomplete.Filter>
            </Autocomplete.Popover>
          </Autocomplete>
        )
      }}
    />
  )
}

/**
 * タグ名で複数選択する Select(絞り込み条件用)。react-hook-form には依存しない。
 *
 * 同じファイルの `TagSelect` との違い:
 * - 値が **タグ名の配列**(tagId ではない)。ボード横断でも同名タグを 1 条件に畳むため
 * - 検索入力 / 新規作成を持たないので Autocomplete ではなく Select で構成する
 *
 * collection のキーもタグ名にするため、`options` は呼び出し側で
 * `dedupeTagOptionsByName`(lib/task.ts) を通して同名を畳んでおくこと。
 */
export const TagNameSelectField: FC<{
  options: TagSelectOption[]
  /** 選択中のタグ名 */
  value: string[]
  onChange: (value: string[]) => void
  label?: string
  /** 選択できる最大件数。到達したら未選択のタグを選べなくする */
  max?: number
  variant?: 'primary' | 'secondary'
  errorMessage?: string
  isSmart?: boolean
}> = ({ options, value, onChange, label, max, variant, errorMessage, isSmart: isSmartProp }) => {
  const isSmart = useIsSmart(isSmartProp)
  const { t } = useLocale()
  // 選択順で並べる(options 順ではなく選んだ順にチップが増える)
  const selected = value.flatMap((name) => options.filter((tag) => tag.name === name))
  const isFull = max !== undefined && value.length >= max
  // 上限に達したら未選択のタグだけ選べなくする。
  // 選択済みも無効にすると disabledBehavior='all' により press が届かず解除もできなくなる。
  const disabledKeys = isFull ? options.filter((tag) => !value.includes(tag.name)).map((tag) => tag.name) : NO_KEYS

  return (
    <Select
      selectionMode='multiple'
      value={value}
      variant={variant}
      isInvalid={!!errorMessage}
      disabledKeys={disabledKeys}
      // タグが 0 件でも開けるようにする(react-aria は collection が空だと開かない)
      allowsEmptyCollection
      onChange={(keys) => onChange(keys.map(String))}
    >
      <Label className={isSmart ? 'text-xs font-light' : ''}>
        {label ?? t('tags')}
        {max !== undefined && <span className='ml-1 text-xs opacity-60'>{`${value.length}/${max}`}</span>}
      </Label>
      {/* isSmart: 既定 36px(min-h-9 + py-2)を 28px へ。text-sm の行高 20px + 上下 4px */}
      <Select.Trigger className={isSmart ? 'min-h-7 py-1' : undefined}>
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
        {/* Select には Autocomplete.ClearButton 相当が無いので手書きする */}
        {value.length > 0 && (
          <span
            role='button'
            aria-label='clear'
            tabIndex={-1}
            className='ml-auto inline-flex cursor-pointer items-center opacity-60 hover:opacity-100'
            // トリガーの onClick は開閉なので × では伝播を止める
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onChange([])
            }}
          >
            <XCircleIcon width={16} />
          </span>
        )}
        <Select.Indicator />
      </Select.Trigger>
      <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
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
}
