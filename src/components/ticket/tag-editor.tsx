'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { InputField } from '@/components/general/input'
import { useConfirmModal } from '@/components/general/modal'
import { CheckIcon, PencilSquareIcon, TrashIcon, XMarkIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import type { TagColor } from '@/generated/prisma/enums'
import { MAX_TAG_NAME, MAX_TAGS_PER_SCOPE, TAG_COLORS } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { tv } from 'tailwind-variants'
import { TagChip, tagColorClass } from './ticket-chip'

export type TagEditorItem = {
  id: string
  name: string
  color: TagColor
  order: number
  ticketCount: number
}

/** 色見本の丸。選択中だけ枠に色を付ける(枠の幅は常に確保してレイアウトを動かさない) */
const swatchStyles = tv({
  base: 'h-5 w-5 cursor-pointer rounded-full border-2',
  variants: { selected: { true: 'border-accent', false: 'border-transparent' } },
})

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
          className={swatchStyles({ selected: color === value, className: tagColorClass(color) })}
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
    <FlexRow isSmart className='flex-wrap items-end gap-2 rounded-xl border-2 p-2'>
      <div className='min-w-40 grow'>
        <InputField
          label={t('name')}
          value={name}
          variant='secondary'
          maxLength={MAX_TAG_NAME}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className='w-20'>
        <InputField
          label={t('display_order')}
          value={order}
          variant='secondary'
          inputMode='numeric'
          onChange={(e) => setOrder(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      <div className='grow'>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className='flex items-center gap-1'>
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
    </FlexRow>
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
}> = ({ tags, canManage, onCreate, onUpdate, onDelete }) => {
  const { t } = useLocale()
  const { confirmModal } = useConfirmModal()
  const [editingId, setEditingId] = useState<string>()
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

  return (
    <FlexCol>
      {/* 作成は canManage を問わない(member もチケット編集中に新しいタグが必要になる) */}
      {tags.length < MAX_TAGS_PER_SCOPE && (
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
    </FlexCol>
  )
}
