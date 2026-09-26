'use client'

import { MultiButton } from '@/components/general/button'
import { getFieldConstraints } from '@/components/general/field-constraints'
import { DialogModal, useModalState } from '@/components/general/modal'
import { ArrowLeftCircleIcon, CheckIcon } from '@/components/icon'
import { MarkdownInput } from '@/components/markdown/markdown-editor'
import type { MentionCandidate } from '@/components/markdown/mention-menu'
import { notify } from '@/components/notify'
import type { TicketCommentDecision, TicketCommentType } from '@/generated/prisma/enums'
import { parseAction } from '@/lib/action/action-client'
import { scDecideAgentComment } from '@/lib/schema/schema-ticket'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { decideAgentComment } from './server'

const MAX_REASON_LENGTH = getFieldConstraints(scDecideAgentComment, 'content').maxLength

/**
 * エージェントの plan / report への承認・差し戻しボタン。
 *
 * - plan の承認はワンクリックで定型文の返信を投稿する(エージェントは revise で実装へ進む)
 * - report の承認はチケットを完了にするので確認を挟む
 * - 差し戻しは理由を入力して返信する
 */
export const AgentDecisionButtons: FC<{
  commentId: string
  type: TicketCommentType
  /** 差し戻し理由に貼った画像の添付先 */
  boardId: string
  mentionCandidates?: MentionCandidate[]
  onDecided: () => Promise<void> | void
}> = ({ commentId, type, boardId, mentionCandidates, onDecided }) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()
  const rejectModal = useModalState()
  const [pending, setPending] = useState<TicketCommentDecision>()
  const [reason, setReason] = useState('')

  const decide = async (decision: TicketCommentDecision, content: string) => {
    setPending(decision)
    try {
      await parseAction(decideAgentComment({ commentId, decision, content }))
      notify.success(t('msg_decision_sent'))
      await onDecided()
      return true
    } catch {
      // エラー表示は parseAction 側で済んでいる
      return false
    } finally {
      setPending(undefined)
    }
  }

  const approve = async () => {
    if (type === 'plan') {
      await decide('approved', t('decision_approve_plan_text'))
      return
    }
    await confirmAction({ title: t('decision_approve'), text: t('msg_confirm_approve_report') }, async () => {
      await decide('approved', t('decision_approve_report_text'))
    })
  }

  const reject = async () => {
    if (await decide('rejected', reason)) {
      setReason('')
      rejectModal.close()
    }
  }

  const isReasonValid = !!reason.trim() && (MAX_REASON_LENGTH === undefined || reason.length <= MAX_REASON_LENGTH)

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <MultiButton
        size='sm'
        icon={<CheckIcon width={16} />}
        isPending={pending === 'approved'}
        isDisabled={!!pending}
        onPress={approve}
      >
        {t('decision_approve')}
      </MultiButton>
      <MultiButton
        size='sm'
        variant='outline'
        icon={<ArrowLeftCircleIcon width={16} />}
        isDisabled={!!pending}
        onPress={() => rejectModal.open()}
      >
        {t('decision_reject')}
      </MultiButton>

      <DialogModal
        key={rejectModal.key}
        state={rejectModal}
        size='2xl'
        title={{ text: t('decision_reject'), icon: <ArrowLeftCircleIcon /> }}
        submit={{
          label: t('decision_reject'),
          icon: <ArrowLeftCircleIcon width={16} />,
          isPending: pending === 'rejected',
          isDisabled: !isReasonValid,
          onPress: reject,
        }}
      >
        <MarkdownInput
          defaultValue={reason}
          onChange={setReason}
          length={reason.length}
          maxLength={MAX_REASON_LENGTH}
          label={t('decision_reject_reason')}
          uploadBoardId={boardId}
          mentionCandidates={mentionCandidates}
        />
      </DialogModal>
    </div>
  )
}
