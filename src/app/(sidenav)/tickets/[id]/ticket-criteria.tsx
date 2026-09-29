'use client'

import { MultiButton, SubmitButtons } from '@/components/general/button'
import { CheckboxField } from '@/components/general/checkbox'
import { FlexCol } from '@/components/general/flex'
import { InputField } from '@/components/general/input'
import {
  CheckBadgeIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardDocumentCheckIcon,
  PencilSquareIcon,
  PlusIcon,
  XCircleIcon,
  XMarkIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { MAX_CRITERION_TEXT, MAX_TICKET_CRITERIA, zCriterionText } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import { Popover } from '@heroui/react'
import { nanoid } from 'nanoid'
import { FC, PointerEvent, useEffect, useRef, useState } from 'react'
import { checkTicketCriterion, GetTicketReturnType, saveTicketCriteria } from './server'

type Ticket = NonNullable<GetTicketReturnType>
type Criterion = Ticket['criteria'][number]

/** 編集中の 1 行。key は並べ替えても入力欄を取り違えないための描画用 */
type DraftRow = { key: string; id?: string; text: string }

/** 閉じた状態 / マウスを乗せて開いた状態 / 押して開いた状態 */
type SelfReportOpenMode = 'closed' | 'hover' | 'press'

const HOVER_OPEN_DELAY = 300
const HOVER_CLOSE_DELAY = 150

/**
 * エージェントの自己申告。根拠は行を圧迫しないようポップオーバーに回す。
 * Tooltip はタップで開けずスマホで根拠を見られないため、マウスを乗せても押しても開く Popover にしている。
 * マウスで開いたときは外へ出れば閉じるよう非モーダルにし、押して開いたときは外側のタップで閉じられるようモーダルにする。
 */
const CriterionSelfReport: FC<{ met: boolean; evidence: string | null }> = ({ met, evidence }) => {
  const { t } = useLocale()
  const [mode, setMode] = useState<SelfReportOpenMode>('closed')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const isPressing = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])

  const schedule = (next: (current: SelfReportOpenMode) => SelfReportOpenMode, delay: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMode(next), delay)
  }
  const hoverHandlers = {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        schedule((current) => (current === 'closed' ? 'hover' : current), HOVER_OPEN_DELAY)
      }
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        schedule((current) => (current === 'hover' ? 'closed' : current), HOVER_CLOSE_DELAY)
      }
    },
  }

  const onOpenChange = (isOpen: boolean) => {
    clearTimeout(timer.current)
    // マウスで開いている最中のクリックは閉じずに押して開いた状態へ切り替える
    setMode(isOpen || (mode === 'hover' && isPressing.current) ? 'press' : 'closed')
    isPressing.current = false
  }

  const result = t(met ? 'criterion_agent_met' : 'criterion_agent_unmet')
  return (
    <Popover isOpen={mode !== 'closed'} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label={`${t('criterion_self_report')}: ${result}`}
        className='flex cursor-pointer items-center gap-0.5'
        onPointerDown={() => (isPressing.current = true)}
        {...hoverHandlers}
      >
        {met ? (
          <CheckBadgeIcon width={14} className='text-success' />
        ) : (
          <XCircleIcon width={14} className='text-danger' />
        )}
        {t('criterion_self_report')}
      </Popover.Trigger>
      <Popover.Content isNonModal={mode === 'hover'} placement='bottom start' className='max-w-sm' {...hoverHandlers}>
        <Popover.Dialog
          aria-label={t('criterion_self_report')}
          className='max-h-64 overflow-y-auto text-sm wrap-break-word whitespace-pre-wrap'
        >
          <div className='font-medium'>{result}</div>
          {evidence && <div>{evidence}</div>}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

/** 表示モードの 1 行。チェックは人の最終確認、2 行目にエージェントの自己申告と人の確認結果を並べる */
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
    <li className='dark:bg-default/40 space-y-1 rounded-lg bg-white px-2 py-0.5'>
      <CheckboxField
        id={`criterion-${criterion.id}`}
        variant='secondary' // 行の背景が白いので、同じ白の枠にならないようにする
        label={criterion.text}
        isSelected={criterion.checkedAt !== null}
        isDisabled={!canEdit || isSaving}
        onChange={toggle}
      />
      {(criterion.agentMet !== null || criterion.checkedAt) && (
        <div className='text-muted flex flex-wrap items-center gap-x-4 gap-y-0.5 pl-7 text-xs'>
          {criterion.agentMet !== null && (
            <CriterionSelfReport met={criterion.agentMet} evidence={criterion.agentEvidence} />
          )}
          {criterion.checkedAt && (
            <div className='flex items-center gap-0.5'>
              <CheckBadgeIcon width={14} className='text-success' />
              {t('criterion_checked_by', { name: criterion.checkedByName || t('no_name') })}
              <span className='ml-2 font-mono'>{dayformat(criterion.checkedAt, 'tz-minute', tz)}</span>
            </div>
          )}
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
    <section className='pb-4'>
      <div className='flex min-h-8 items-center justify-between gap-2'>
        <h3 className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium'>
          <span className='flex items-center gap-1'>
            <ClipboardDocumentCheckIcon width={18} />
            {t('acceptance_criteria')} ({criteria.length})
          </span>
          {criteria.length > 0 && (
            <span className='text-muted text-xs font-normal'>{t('criteria_summary', summary)}</span>
          )}
        </h3>
        {canEdit && !isEditing && (
          <MultiButton
            isIconOnly
            size='sm'
            variant='outline'
            tooltip={t('update')}
            icon={<PencilSquareIcon width={16} />}
            onPress={() => setEditing(true)}
          />
        )}
      </div>
      <FlexCol isSmart className='px-3 pt-2'>
        {isEditing ? (
          <CriteriaEditor ticket={ticket} onClose={() => setEditing(false)} refresh={refresh} />
        ) : criteria.length > 0 ? (
          <ul className='space-y-1'>
            {criteria.map((criterion) => (
              <CriterionRow key={criterion.id} criterion={criterion} canEdit={canEdit} refresh={refresh} />
            ))}
          </ul>
        ) : (
          <span className='text-muted text-sm'>{t('msg_no_criteria')}</span>
        )}
      </FlexCol>
    </section>
  )
}
