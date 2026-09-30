'use client'

import { MultiButton } from '@/components/general/button'
import { InputField } from '@/components/general/input'
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, XMarkIcon } from '@/components/icon'
import { MAX_CRITERION_TEXT, MAX_TICKET_CRITERIA, zCriterionText } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import { nanoid } from 'nanoid'
import { FC, ReactNode } from 'react'

/** 編集中の 1 行。key は並べ替えても入力欄を取り違えないための描画用 */
export type CriterionDraftRow = { key: string; id?: string; text: string }

/** 文言の一覧から新規の行を作る(テンプレートの受け入れ条件など、id を持たないもの) */
export const toCriterionDraftRows = (texts: string[]): CriterionDraftRow[] =>
  texts.map((text) => ({ key: nanoid(), text }))

/** 空の行は保存時に捨てるので、入力途中の空行があっても保存できる */
export const filledCriterionRows = (rows: CriterionDraftRow[]) => rows.filter((row) => row.text.trim())

export const isValidCriterionRows = (rows: CriterionDraftRow[]) =>
  filledCriterionRows(rows).every((row) => zCriterionText.safeParse(row.text).success)

/**
 * 受け入れ条件の行の追加・削除・並べ替え・文言変更。保存は呼び出し側が持ち、`action` に並べる
 */
export const CriteriaRowsField: FC<{
  rows: CriterionDraftRow[]
  onChange: (rows: CriterionDraftRow[]) => void
  action?: ReactNode
}> = ({ rows, onChange, action }) => {
  const { t } = useLocale()

  const update = (key: string, text: string) => onChange(rows.map((row) => (row.key === key ? { ...row, text } : row)))
  const remove = (key: string) => onChange(rows.filter((row) => row.key !== key))
  const move = (index: number, offset: number) => {
    const next = [...rows]
    const [row] = next.splice(index, 1)
    next.splice(index + offset, 0, row)
    onChange(next)
  }

  return (
    <div className='space-y-2'>
      {rows.map((row, index) => (
        <div key={row.key} className='flex items-center gap-1'>
          <div className='grow'>
            <InputField
              isSmart
              isLabelHidden
              label={t('criterion_text')}
              aria-label={t('criterion_text')}
              value={row.text}
              maxLength={MAX_CRITERION_TEXT}
              onChange={(e) => update(row.key, e.target.value)}
            />
          </div>
          <div className='flex shrink-0'>
            <MultiButton
              isIconOnly
              size='sm'
              variant='ghost'
              tooltip={t('move_up')}
              icon={<ChevronUpIcon width={16} />}
              isDisabled={index === 0}
              onPress={() => move(index, -1)}
            />
            <MultiButton
              isIconOnly
              size='sm'
              variant='ghost'
              tooltip={t('move_down')}
              icon={<ChevronDownIcon width={16} />}
              isDisabled={index === rows.length - 1}
              onPress={() => move(index, 1)}
            />
          </div>
          <MultiButton
            isIconOnly
            size='sm'
            variant='ghost'
            tooltip={t('delete')}
            icon={<XMarkIcon width={16} />}
            onPress={() => remove(row.key)}
          />
        </div>
      ))}
      <div className='flex flex-wrap items-center gap-2'>
        <MultiButton
          size='sm'
          variant='outline'
          icon={<PlusIcon width={16} />}
          isDisabled={rows.length >= MAX_TICKET_CRITERIA}
          onPress={() => onChange([...rows, { key: nanoid(), text: '' }])}
        >
          {t('add_criterion')}
        </MultiButton>
        {action && <div className='ml-auto flex gap-2'>{action}</div>}
      </div>
    </div>
  )
}
