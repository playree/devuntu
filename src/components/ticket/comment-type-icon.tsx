import { ClipboardDocumentCheckIcon, ClipboardDocumentIcon } from '@/components/icon'
import type { TicketCommentType } from '@/generated/prisma/enums'
import { FC } from 'react'

/** プラン/報告書のアイコン。詳細画面と印刷用ページで同じものを出す */
export const CommentTypeIcon: FC<{ type: TicketCommentType; width?: number }> = ({ type, width = 16 }) =>
  type === 'plan' ? <ClipboardDocumentIcon width={width} /> : <ClipboardDocumentCheckIcon width={width} />
