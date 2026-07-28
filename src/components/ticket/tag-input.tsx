'use client'

import { MultiButton } from '@/components/general/button'
import { PlusIcon, XMarkIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Chip, ErrorMessage, Input, Label, TextField } from '@heroui/react'
import { KeyboardEvent, useState } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

const MAX_TAGS = 10
const MAX_TAG_LENGTH = 20

/**
 * tags(String[]) の編集。Enter または追加ボタンで確定し、Chip として並べる。
 * 表記揺れを完全には防げないため、少なくとも trim と重複除去は行う。
 */
export const TagInput = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  label,
  errorMessage,
  suggestions = [],
}: {
  control: Control<TFieldValues>
  name: TName
  label?: string
  errorMessage?: string
  /** 既存タグの候補(クリックで追加できる) */
  suggestions?: string[]
}) => {
  const { t } = useLocale()
  const [draft, setDraft] = useState('')

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value } }) => {
        const tags: string[] = Array.isArray(value) ? value : []

        const add = (raw: string) => {
          const tag = raw.trim()
          if (!tag || tags.length >= MAX_TAGS || tags.includes(tag)) {
            setDraft('')
            return
          }
          onChange([...tags, tag])
          setDraft('')
        }

        const remove = (tag: string) => onChange(tags.filter((t) => t !== tag))

        const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            // フォーム全体の submit を防いでタグ確定に使う
            e.preventDefault()
            add(draft)
          }
        }

        const available = suggestions.filter((tag) => !tags.includes(tag))

        return (
          <div className='space-y-2'>
            <TextField isInvalid={!!errorMessage}>
              <Label>{label ?? t('tags')}</Label>
              <div className='flex items-center gap-2'>
                <Input
                  value={draft}
                  variant='secondary'
                  maxLength={MAX_TAG_LENGTH}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                />
                <MultiButton
                  isIconOnly
                  size='sm'
                  tooltip={t('tags')}
                  isDisabled={!draft.trim() || tags.length >= MAX_TAGS}
                  onPress={() => add(draft)}
                >
                  <PlusIcon />
                </MultiButton>
              </div>
              <ErrorMessage className='min-h-4'>{errorMessage}</ErrorMessage>
            </TextField>

            {tags.length > 0 && (
              <div className='flex flex-wrap gap-1'>
                {tags.map((tag) => (
                  <Chip key={tag} variant='soft' color='accent'>
                    <Chip.Label>{tag}</Chip.Label>
                    <span
                      role='button'
                      aria-label={`remove ${tag}`}
                      tabIndex={-1}
                      className='ml-1 inline-flex cursor-pointer items-center opacity-60 hover:opacity-100'
                      onClick={() => remove(tag)}
                    >
                      <XMarkIcon width={14} />
                    </span>
                  </Chip>
                ))}
              </div>
            )}

            {available.length > 0 && tags.length < MAX_TAGS && (
              <div className='flex flex-wrap items-center gap-1'>
                {available.slice(0, 20).map((tag) => (
                  <Chip key={tag} variant='tertiary' className='cursor-pointer' role='button' onClick={() => add(tag)}>
                    <Chip.Label>{tag}</Chip.Label>
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )
      }}
    />
  )
}
