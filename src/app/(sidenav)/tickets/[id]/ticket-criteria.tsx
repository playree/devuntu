'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton, SubmitButtons } from '@/components/general/button'
import { CheckboxField } from '@/components/general/checkbox'
import { FlexCol } from '@/components/general/flex'
import { InputField } from '@/components/general/input'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardDocumentCheckIcon,
  PencilSquareIcon,
  PlusIcon,
  XMarkIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { CriterionAgentChip, type CriterionAgentResult } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { MAX_CRITERION_TEXT, MAX_TICKET_CRITERIA, zCriterionText } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import { nanoid } from 'nanoid'
import { FC, useState } from 'react'
import { checkTicketCriterion, GetTicketReturnType, saveTicketCriteria } from './server'

type Ticket = NonNullable<GetTicketReturnType>
type Criterion = Ticket['criteria'][number]

/** 編集中の 1 行。key は並べ替えても入力欄を取り違えないための描画用 */
type DraftRow = { key: string; id?: string; text: string }

const toAgentResult = (agentMet: boolean | null): CriterionAgentResult =>
  agentMet === null ? 'unreported' : agentMet ? 'met' : 'unmet'

/** 表示モードの 1 行。チェックは人の最終確認、Chip はエージェントの自己申告 */
const CriterionRow: FC<{ criterion: Criterion; canEdit: boolean; refresh: () => Promise<void> }> = ({
  criterion,
  canEdit,
  refresh,
}) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const [isSaving, setSaving] = useState(false)

  const toggle = async (checked: boolean) => {
    setSaving(true)
    try {
      await parseAction(checkTicketCriterion({ id: criterion.id, checked }))
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className='space-y-1'>
      <div className='flex items-start gap-2'>
        <div className='min-w-0 grow'>
          <CheckboxField
            id={`criterion-${criterion.id}`}
            label={criterion.text}
            isSelected={criterion.checkedAt !== null}
            isDisabled={!canEdit || isSaving}
            onChange={toggle}
          />
        </div>
        <CriterionAgentChip value={toAgentResult(criterion.agentMet)} />
      </div>
      {(criterion.checkedAt || criterion.agentEvidence) && (
        <div className='text-muted space-y-0.5 pl-7 text-xs'>
          {criterion.checkedAt && (
            <div>
              {t('criterion_checked_by', { name: criterion.checkedByName || t('no_name') })}
              <span className='ml-2 font-mono'>{dayformat(criterion.checkedAt, 'tz-minute', tz)}</span>
            </div>
          )}
          {criterion.agentEvidence && <div className='break-words whitespace-pre-wrap'>{criterion.agentEvidence}</div>}
        </div>
      )}
    </li>
  )
}

/** 編集モード。行の追加・削除・並べ替え・文言変更をまとめて保存する */
const CriteriaEditor: FC<{
  ticket: Ticket
  onClose: () => void
  refresh: () => Promise<void>
}> = ({ ticket, onClose, refresh }) => {
  const { t } = useLocale()
  const [rows, setRows] = useState<DraftRow[]>(() => ticket.criteria.map(({ id, text }) => ({ key: id, id, text })))
  const [isSaving, setSaving] = useState(false)

  const update = (key: string, text: string) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, text } : row)))
  const remove = (key: string) => setRows((current) => current.filter((row) => row.key !== key))
  const move = (index: number, offset: number) =>
    setRows((current) => {
      const next = [...current]
      const [row] = next.splice(index, 1)
      next.splice(index + offset, 0, row)
      return next
    })

  // 空の行は保存時に捨てるので、入力途中の空行があっても保存できる
  const filled = rows.filter((row) => row.text.trim())
  const isValid = filled.every((row) => zCriterionText.safeParse(row.text).success)

  const save = async () => {
    setSaving(true)
    try {
      await parseAction(
        saveTicketCriteria({ ticketId: ticket.id, items: filled.map(({ id, text }) => ({ id, text })) }),
      )
      notify.success(t('msg_saved'))
      await refresh()
      onClose()
    } catch {
      // エラー表示は parseAction 側で済んでいる。編集中の内容を失わせないため編集状態は維持する
    } finally {
      setSaving(false)
    }
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
          onPress={() => setRows((current) => [...current, { key: nanoid(), text: '' }])}
        >
          {t('add_criterion')}
        </MultiButton>
        <div className='ml-auto flex gap-2'>
          <SubmitButtons
            size='sm'
            label={t('save')}
            icon={<CheckIcon width={16} />}
            isPending={isSaving}
            isDisabled={!isValid}
            onPress={save}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  )
}

/** 受け入れ条件。人の確認とエージェントの自己申告を 1 行に並べて見せる */
export const TicketCriteria: FC<{ ticket: Ticket; refresh: () => Promise<void> }> = ({ ticket, refresh }) => {
  const { t } = useLocale()
  const [isEditing, setEditing] = useState(false)

  const { criteria, canEdit } = ticket
  // 編集できない人に空の見出しだけを見せても意味が無い
  if (criteria.length === 0 && !canEdit) {
    return null
  }

  const summary = {
    total: criteria.length,
    checked: criteria.filter((criterion) => criterion.checkedAt !== null).length,
    met: criteria.filter((criterion) => criterion.agentMet === true).length,
  }

  return (
    <AccordionSection
      id='criteria'
      icon={<ClipboardDocumentCheckIcon />}
      title={
        <span className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <span>
            {t('acceptance_criteria')} ({criteria.length})
          </span>
          {criteria.length > 0 && <span className='text-muted text-xs'>{t('criteria_summary', summary)}</span>}
        </span>
      }
      bodyClassName='px-0'
    >
      <FlexCol isSmart>
        {canEdit && !isEditing && (
          <MultiButton // 見出しは開閉のボタンなので、編集ボタンは中身の側に置く
            isIconOnly
            size='sm'
            variant='outline'
            className='self-end'
            tooltip={t('update')}
            icon={<PencilSquareIcon width={16} />}
            onPress={() => setEditing(true)}
          />
        )}

        {isEditing ? (
          <CriteriaEditor ticket={ticket} onClose={() => setEditing(false)} refresh={refresh} />
        ) : criteria.length > 0 ? (
          <ul className='space-y-2'>
            {criteria.map((criterion) => (
              <CriterionRow key={criterion.id} criterion={criterion} canEdit={canEdit} refresh={refresh} />
            ))}
          </ul>
        ) : (
          <span className='text-muted text-sm'>{t('msg_no_criteria')}</span>
        )}
      </FlexCol>
    </AccordionSection>
  )
}
