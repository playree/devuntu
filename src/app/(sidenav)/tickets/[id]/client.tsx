'use client'

import { FlexCol } from '@/components/general/flex'
import { PanelSkeleton } from '@/components/general/panel'
import { TicketIcon } from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { notify } from '@/components/notify'
import type { AgentTaskMode, TicketStatus } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { PatchTicketIn } from '@/lib/schema/schema-ticket'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'
import { deleteTicket } from '../server'
import { type BoardAssignee, type TicketFormOptions, useBoardAssignees, useTicketFormOptions } from '../use-ticket-form'
import { TicketComments } from './comments'
import { getTicket, patchTicket, updateTicketAgentMode, updateTicketStatus } from './server'
import { TicketBody } from './ticket-body'
import { type Draft, type EditField, TicketFieldPanel } from './ticket-fields'
import { CloseButton, TicketHeader } from './ticket-header'
import { TicketLinks } from './ticket-links'

export const TicketDetailClient: FC<{
  id: string
  /** 一覧に埋め込んだときの閉じる操作。未指定なら一覧へ遷移する */
  onClose?: () => void
  /** 一覧に埋め込んだときの変更通知。一覧の再読込に使う */
  onChanged?: () => void
  /** 一覧側で取得済みの選択肢。渡すと取り直さない */
  formOptions?: TicketFormOptions
  /** 一覧側で取得済みの担当者候補(同じボードのもの)。渡すと取り直さない */
  boardAssignees?: BoardAssignee[]
}> = ({ id, onClose, onChanged, formOptions, boardAssignees: initialAssignees }) => {
  const { t } = useLocale()
  const router = useRouter()
  const confirmAction = useConfirmAction()

  const { data: ticket, refresh, isLoading } = useActionData(() => getTicket({ id }))
  const { options } = useTicketFormOptions(formOptions)
  // 担当者候補はそのボードのメンバー(プライベートボードなら本人のみ)
  const { assignees: boardAssignees } = useBoardAssignees(ticket?.boardId, initialAssignees)
  const [savingField, setSavingField] = useState<EditField>()
  const [draft, setDraft] = useState<Draft>({})
  // 件名は入力途中の値を保持する必要があるため state で持つ
  const [title, setTitle] = useState('')
  // 同期済みのサーバー値。取得し直したかの判定に使う
  const [syncedTicket, setSyncedTicket] = useState<typeof ticket>()

  // 再取得でサーバー値が変わったら楽観値を捨て、件名の入力欄を同期する(レンダー中に調整)
  if (ticket && ticket !== syncedTicket) {
    setSyncedTicket(ticket)
    setTitle(ticket.title)
    setDraft({})
  }

  /** サーバー値を取り直し、埋め込み元(一覧)にも変更を伝える */
  const refreshAll = async () => {
    await refresh()
    onChanged?.()
  }

  /** 閉じる操作。埋め込み時は選択解除、単独ページでは一覧へ戻る */
  const close = () => {
    if (onClose) {
      onClose()
    } else {
      router.push('/tickets')
    }
  }

  /**
   * 1 項目だけ更新する。保存中は楽観値を表示しておき、refresh で正の値に置き換える。
   * refresh(isLoading を立てない再取得)を await するのは、サーバー値が届くまで
   * 保存中の状態を維持して、旧値が一瞬見えるのを防ぐため。
   */
  const patch = async (field: EditField, input: Partial<PatchTicketIn>) => {
    setSavingField(field)
    setDraft(input)
    try {
      await parseAction(patchTicket({ id, ...input }))
      notify.success(t('msg_saved'))
      await refreshAll()
    } catch {
      // エラー表示は parseAction 側で済んでいる。楽観値を捨ててサーバー値に戻す
      setDraft({})
    } finally {
      setSavingField(undefined)
    }
  }

  /** エージェントモードは承認者だけの操作なので専用 Action を使う */
  const changeAgentMode = async (agentMode: AgentTaskMode | null) => {
    setSavingField('agentMode')
    setDraft({ agentMode })
    try {
      await parseAction(updateTicketAgentMode({ id, agentMode }))
      notify.success(t('msg_saved'))
      await refreshAll()
    } catch {
      setDraft({})
    } finally {
      setSavingField(undefined)
    }
  }

  /** ステータスはレーン順の再採番を伴うため専用 Action を使う */
  const changeStatus = async (status: TicketStatus) => {
    setSavingField('status')
    setDraft({ status })
    try {
      await parseAction(updateTicketStatus({ id, status }))
      notify.success(t('msg_saved'))
      await refreshAll()
    } catch {
      setDraft({})
    } finally {
      setSavingField(undefined)
    }
  }

  const remove = async () => {
    if (!ticket) {
      return
    }
    await confirmAction(
      { title: t('confirm_deletion'), text: t('msg_confirm_deletion', { target: ticket.title }) },
      async () => {
        await parseAction(deleteTicket({ id }))
        notify.success(t('msg_deleted_target', { target: ticket.title }))
        onChanged?.()
        close()
      },
    )
  }

  if (isLoading) {
    return <PanelSkeleton />
  }

  // useActionData は ClientError を通知しないため、取得できなかったことをここで表示する
  if (!ticket) {
    return (
      <NoAccessView
        title={
          <>
            {onClose && <CloseButton onClose={onClose} />}
            <TicketIcon />
            {t('ticket')}
          </>
        }
      />
    )
  }

  return (
    <FlexCol>
      <TicketHeader ticket={ticket} onClose={onClose} />

      <TicketFieldPanel
        ticket={ticket}
        draft={draft}
        savingField={savingField}
        title={title}
        onTitleChange={setTitle}
        options={options}
        boardAssignees={boardAssignees}
        patch={patch}
        changeStatus={changeStatus}
        changeAgentMode={changeAgentMode}
        onRemove={remove}
      />

      <TicketBody ticket={ticket} boardAssignees={boardAssignees} refresh={refreshAll} />

      <TicketLinks ticket={ticket} refresh={refreshAll} />

      <TicketComments ticket={ticket} mentionCandidates={boardAssignees} refresh={refreshAll} />
    </FlexCol>
  )
}
