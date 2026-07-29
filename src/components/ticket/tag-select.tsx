'use client'

import { MultiButton } from '@/components/general/button'
import { useIsSmart } from '@/components/general/smart'
import { PlusIcon, XMarkIcon } from '@/components/icon'
import type { TagColor } from '@/generated/prisma/enums'
import { MAX_TAG_NAME, MAX_TICKET_TAGS } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { Chip, ErrorMessage, Input, Label, TextField } from '@heroui/react'
import { KeyboardEvent, useState } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { TagChip } from './ticket-chip'

/** 選択肢として渡すタグ。`lib/tag.ts` の TagOption と構造的に一致させる */
export type TagSelectOption = { id: string; name: string; color: TagColor }

/**
 * チケットのタグ選択(マスタから選ぶ + その場で新規作成)。
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
  isSmart: isSmartProp,
}: {
  control: Control<TFieldValues>
  name: TName
  options: TagSelectOption[]
  /** 作成したタグを返す。同名が既にある場合は既存を返してもよい */
  onCreate?: (name: string) => Promise<TagSelectOption | undefined>
  label?: string
  errorMessage?: string
  isSmart?: boolean
}) => {
  const isSmart = useIsSmart(isSmartProp)
  const { t } = useLocale()
  const [draft, setDraft] = useState('')
  const [isCreating, setCreating] = useState(false)
  // onCreate で作られたタグは options の再取得を待たずに選べるようにする
  const [created, setCreated] = useState<TagSelectOption[]>([])

  const all = [...options, ...created.filter((tag) => !options.some((o) => o.id === tag.id))]

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value } }) => {
        const selectedIds: string[] = Array.isArray(value) ? value : []
        const selected = selectedIds.flatMap((id) => all.filter((tag) => tag.id === id))
        const available = all.filter((tag) => !selectedIds.includes(tag.id))
        const isFull = selectedIds.length >= MAX_TICKET_TAGS

        const add = (tag: TagSelectOption) => {
          if (isFull || selectedIds.includes(tag.id)) {
            return
          }
          onChange([...selectedIds, tag.id])
        }

        const remove = (id: string) => onChange(selectedIds.filter((v) => v !== id))

        const create = async () => {
          const trimmed = draft.trim()
          if (!trimmed || !onCreate || isFull) {
            return
          }
          // 同名が既にあれば作成せず選択のみ
          const existing = all.find((tag) => tag.name === trimmed)
          if (existing) {
            add(existing)
            setDraft('')
            return
          }

          setCreating(true)
          try {
            const tag = await onCreate(trimmed)
            if (tag) {
              setCreated((prev) => [...prev, tag])
              add(tag)
              setDraft('')
            }
          } finally {
            setCreating(false)
          }
        }

        const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            // フォーム全体の submit を防いでタグ確定に使う
            e.preventDefault()
            create()
          }
        }

        return (
          <div className='space-y-2'>
            <TextField isInvalid={!!errorMessage}>
              <Label className={isSmart ? 'text-xs font-light' : ''}>{label ?? t('tags')}</Label>
              {onCreate && (
                <div className='flex items-center gap-2'>
                  <Input
                    value={draft}
                    variant='secondary'
                    maxLength={MAX_TAG_NAME}
                    className={isSmart ? 'py-1' : ''}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                  />
                  <MultiButton
                    isIconOnly
                    size='sm'
                    tooltip={t('add_tag')}
                    isPending={isCreating}
                    isDisabled={!draft.trim() || isFull}
                    onPress={create}
                    isSmart
                  >
                    <PlusIcon />
                  </MultiButton>
                </div>
              )}
              <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
            </TextField>

            {selected.length > 0 && (
              <div className='flex flex-wrap gap-1'>
                {selected.map((tag) => (
                  <TagChip key={tag.id} tag={tag}>
                    <span
                      role='button'
                      aria-label={`remove ${tag.name}`}
                      tabIndex={-1}
                      className='ml-1 inline-flex cursor-pointer items-center opacity-60 hover:opacity-100'
                      onClick={() => remove(tag.id)}
                    >
                      <XMarkIcon width={14} />
                    </span>
                  </TagChip>
                ))}
              </div>
            )}

            {available.length > 0 && !isFull && (
              <div className='flex flex-wrap items-center gap-1'>
                {available.map((tag) => (
                  <TagChip
                    key={tag.id}
                    tag={tag}
                    className='cursor-pointer opacity-60 hover:opacity-100'
                    onClick={() => add(tag)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      }}
    />
  )
}

/** 選択肢が空のときに出す注記(タグ管理への誘導は呼び出し側で行う) */
export const NoTagsHint = () => {
  const { t } = useLocale()
  return <Chip variant='tertiary'>{t('msg_no_tags')}</Chip>
}
