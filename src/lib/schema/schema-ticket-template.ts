/**
 * チケットテンプレートの入力スキーマ
 */

import { el } from '@/locale'
import { z } from 'zod'
import { MAX_TEMPLATE_NAME } from '../board/ticket-template-rule'
import { MAX_TICKET_CRITERIA, zCriterionText, zTagIds, zTicketContent, zTicketPriority } from './schema-ticket'

export const zTemplateName = z
  .string()
  .trim()
  .min(1, el('@required_field'))
  .max(MAX_TEMPLATE_NAME, el('@invalid_template_name'))

/** テンプレートの編集フォーム。受け入れ条件は空行を捨てたうえで渡す */
export const scTicketTemplateFields = z.object({
  name: zTemplateName,
  content: zTicketContent.default(''),
  criteria: z.array(zCriterionText).max(MAX_TICKET_CRITERIA, el('@too_many_criteria')),
  tagIds: zTagIds,
  /** null = 指定なし(作成側の既定値のまま) */
  priority: zTicketPriority.nullable(),
})
export type TicketTemplateFields = z.infer<typeof scTicketTemplateFields>
export type TicketTemplateFieldsIn = z.input<typeof scTicketTemplateFields>

export const scCreateTicketTemplate = scTicketTemplateFields.extend({ boardId: z.uuidv7() })
export type CreateTicketTemplate = z.infer<typeof scCreateTicketTemplate>

export const scUpdateTicketTemplate = scTicketTemplateFields.extend({ id: z.uuidv7() })
export type UpdateTicketTemplate = z.infer<typeof scUpdateTicketTemplate>
