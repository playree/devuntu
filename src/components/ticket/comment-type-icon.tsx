import { ClipboardDocumentCheckIcon, ClipboardDocumentIcon, MegaphoneIcon } from '@/components/icon'
import type { TicketCommentType } from '@/generated/prisma/enums'
import { FC } from 'react'

const ICONS = {
  plan: ClipboardDocumentIcon,
  report: ClipboardDocumentCheckIcon,
  announcement: MegaphoneIcon,
} as const satisfies Record<TicketCommentType, FC<{ width?: number }>>

/** コメント種別(プラン/報告書/アナウンス)のアイコン。詳細画面と印刷用ページで同じものを出す */
export const CommentTypeIcon: FC<{ type: TicketCommentType; width?: number }> = ({ type, width = 16 }) => {
  const Icon = ICONS[type]
  return <Icon width={width} />
}
