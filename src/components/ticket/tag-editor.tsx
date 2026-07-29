'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { CheckIcon, PencilSquareIcon, PlusIcon, TrashIcon, XMarkIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import type { TagColor } from '@/generated/prisma/enums'
import { MAX_TAG_NAME, MAX_TAGS_PER_SCOPE, TAG_COLORS } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { Input, Label, ListBox, Select } from '@heroui/react'
import { FC, useState } from 'react'
import { TAG_COLOR_CLASS, TagChip } from './ticket-chip'

export type TagEditorItem = {
  id: string
  name: string
  color: TagColor
  order: number
  ticketCount: number
}

/** 色見本を並べた選択 UI(SingleSelectCtrl では色を見せられないため自前で作る) */
const ColorPicker: FC<{ value: TagColor; onChange: (color: TagColor) => void }> = ({ value, onChange }) => {
  const { t } = useLocale()
  return (
    <div className='flex flex-wrap items-center gap-1'>
      <span className='text-xs text-gray-500'>{t('tag_color')}</span>
      {TAG_COLORS.map((color) => (
        <span
          key={color}
          role='button'
          aria-label={color}
          aria-pressed={color === value}
          className={`h-5 w-5 cursor-pointer rounded-full border-2 ${TAG_COLOR_CLASS[color]} ${
            color === value ? 'border-accent' : 'border-transparent'
          }`}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}

/** 1 行ぶんの編集フォーム(新規 / 更新で共有) */
const TagRowForm: FC<{
  initial?: { name: string; color: TagColor; order: number }
  submitLabel: string
  isPending: boolean
  onSubmit: (req: { name: string; color: TagColor; order: number }) => Promise<void>
  onCancel?: () => void
}> = ({ initial, submitLabel, isPending, onSubmit, onCancel }) => {
  const { t } = useLocale()
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState<TagColor>(initial?.color ?? 'gray')
  const [order, setOrder] = useState(String(initial?.order ?? 0))

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    await onSubmit({ name: trimmed, color, order: Number(order) || 0 })
    if (!initial) {
      // 新規作成のときは続けて入力できるよう名前だけ空に戻す
      setName('')
    }
  }

  return (
    <div className='flex flex-wrap items-end gap-2 rounded-xl border-2 p-2'>
      <div className='min-w-40 grow'>
        <Label className='text-xs font-light'>{t('name')}</Label>
        <Input
          value={name}
          variant='secondary'
          maxLength={MAX_TAG_NAME}
          className='py-1'
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className='w-20'>
        <Label className='text-xs font-light'>{t('display_order')}</Label>
        <Input
          value={order}
          variant='secondary'
          className='py-1'
          inputMode='numeric'
          onChange={(e) => setOrder(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      <div className='grow'>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className='flex items-center gap-1'>
        <TagChip tag={{ name: name.trim() || t('tags'), color }} />
        <MultiButton
          size='sm'
          icon={<CheckIcon width={16} />}
          isPending={isPending}
          isDisabled={!name.trim()}
          onPress={submit}
        >
          {submitLabel}
        </MultiButton>
        {onCancel && (
          <MultiButton isIconOnly size='sm' variant='ghost' tooltip={t('cancel')} onPress={onCancel}>
            <XMarkIcon width={16} />
          </MultiButton>
        )}
      </div>
    </div>
  )
}

/**
 * タグ管理の表示部品。
 *
 * Server Action は props で注入する(CLAUDE.md の「Server Actions は利用する Client と
 * 同じ階層の server.ts」を守りつつ、複数のボードで共有できるようにするため)。
 * `canManage` が false のときは作成のみ許可する(member はチケット編集中に新タグが必要になる)。
 */
export const TagEditor: FC<{
  tags: TagEditorItem[]
  canManage: boolean
  onCreate: (req: { name: string; color: TagColor; order: number }) => Promise<void>
  onUpdate: (req: { id: string; name: string; color: TagColor; order: number }) => Promise<void>
  onDelete: (tag: TagEditorItem) => Promise<void>
  onMerge: (req: { sourceId: string; targetId: string }) => Promise<void>
}> = ({ tags, canManage, onCreate, onUpdate, onDelete, onMerge }) => {
  const { t } = useLocale()
  const { confirmModal } = useConfirmModal()
  const [editingId, setEditingId] = useState<string>()
  const [mergeSourceId, setMergeSourceId] = useState<string>()
  const [isPending, setPending] = useState(false)

  const withPending = async (action: () => Promise<void>) => {
    setPending(true)
    try {
      await action()
    } finally {
      setPending(false)
    }
  }

  const remove = async (tag: TagEditorItem) => {
    try {
      const ok = await confirmModal().confirm({
        title: t('confirm_deletion'),
        text: t('msg_confirm_deletion', { target: tag.name }),
        requireCheck: true,
        autoClose: false,
      })
      if (ok) {
        await onDelete(tag)
        notify.success(t('msg_deleted_target', { target: tag.name }))
      }
    } finally {
      confirmModal().close()
    }
  }

  const merge = async (targetId: string) => {
    const source = tags.find((tag) => tag.id === mergeSourceId)
    const target = tags.find((tag) => tag.id === targetId)
    if (!source || !target || source.id === target.id) {
      return
    }
    try {
      const ok = await confirmModal().confirm({
        title: t('merge_tags'),
        text: t('msg_confirm_merge_tags', { source: source.name, target: target.name }),
        requireCheck: true,
        autoClose: false,
      })
      if (ok) {
        await onMerge({ sourceId: source.id, targetId: target.id })
        notify.success(t('msg_saved'))
        setMergeSourceId(undefined)
      }
    } finally {
      confirmModal().close()
    }
  }

  return (
    <FlexCol>
      {canManage && tags.length < MAX_TAGS_PER_SCOPE && (
        <TagRowForm
          submitLabel={t('add_tag')}
          isPending={isPending}
          onSubmit={(req) => withPending(() => onCreate(req))}
        />
      )}

      {tags.length === 0 ? (
        <div className='px-1 text-sm text-gray-500'>{t('msg_no_tags')}</div>
      ) : (
        <div className='space-y-1'>
          {tags.map((tag) =>
            editingId === tag.id ? (
              <TagRowForm
                key={tag.id}
                initial={tag}
                submitLabel={t('update_tag')}
                isPending={isPending}
                onSubmit={async (req) => {
                  await withPending(() => onUpdate({ id: tag.id, ...req }))
                  setEditingId(undefined)
                }}
                onCancel={() => setEditingId(undefined)}
              />
            ) : (
              <div key={tag.id} className='flex items-center gap-2 rounded-xl border-2 px-2 py-1'>
                <TagChip tag={tag} />
                <span className='font-mono text-xs text-gray-500'>#{tag.order}</span>
                <span className='text-xs text-gray-500'>
                  {t('usage_count')}: {tag.ticketCount}
                </span>
                {canManage && (
                  <div className='ml-auto flex items-center gap-0.5'>
                    <MultiButton
                      isIconOnly
                      size='sm'
                      variant='tertiary'
                      className='h-7 w-7 rounded-sm'
                      tooltip={t('update')}
                      onPress={() => setEditingId(tag.id)}
                    >
                      <PencilSquareIcon width={16} />
                    </MultiButton>
                    <MultiButton
                      isIconOnly
                      size='sm'
                      variant={mergeSourceId === tag.id ? 'primary' : 'tertiary'}
                      className='h-7 w-7 rounded-sm'
                      tooltip={mergeSourceId === tag.id ? t('merge_source') : t('merge_tags')}
                      onPress={() => setMergeSourceId(mergeSourceId === tag.id ? undefined : tag.id)}
                    >
                      <PlusIcon width={16} />
                    </MultiButton>
                    <MultiButton
                      isIconOnly
                      size='sm'
                      variant='danger-soft'
                      className='h-7 w-7 rounded-sm'
                      tooltip={t('delete')}
                      onPress={() => remove(tag)}
                    >
                      <TrashIcon width={16} />
                    </MultiButton>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}

      {mergeSourceId && (
        <div className='flex flex-wrap items-center gap-2 rounded-xl border-2 p-2'>
          <span className='text-xs text-gray-500'>
            {t('merge_source')}: {tags.find((tag) => tag.id === mergeSourceId)?.name}
          </span>
          <Select
            selectionMode='single'
            variant='secondary'
            aria-label={t('merge_target')}
            value=''
            isDisabled={isPending}
            onChange={(key) => {
              const id = key?.toString()
              if (id) {
                merge(id)
              }
            }}
          >
            <Label className='sr-only'>{t('merge_target')}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox selectionMode='single'>
                {tags
                  .filter((tag) => tag.id !== mergeSourceId)
                  .map((tag) => (
                    <ListBox.Item key={tag.id} id={tag.id} textValue={tag.name}>
                      {tag.name}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <MultiButton size='sm' variant='ghost' onPress={() => setMergeSourceId(undefined)}>
            {t('cancel')}
          </MultiButton>
        </div>
      )}
    </FlexCol>
  )
}
