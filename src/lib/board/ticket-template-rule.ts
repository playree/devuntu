/**
 * チケットテンプレートの定数と純粋関数
 *
 * サーバー / クライアントの双方から import する。DB アクセスは `ticket-template.ts` を参照。
 */

import type { TicketPriority } from '@/generated/prisma/enums'

/** 1 ボードあたりのテンプレート数の上限(作成画面の選択肢が破綻しない範囲) */
export const MAX_TEMPLATES_PER_BOARD = 20

/** テンプレート名の最大長 */
export const MAX_TEMPLATE_NAME = 40

/** 同じボード内でのテンプレート名の重複(DB の @@unique([boardId, name]) 違反) */
export const DUPLICATED_TEMPLATE_NAME = 'DUPLICATED_TEMPLATE_NAME'

/** チケットへ写す項目 */
export type TicketTemplateValues = {
  content: string
  criteria: string[]
  tagIds: string[]
  priority: TicketPriority | null
}

/** 作成の入力のうちテンプレートで埋める項目。undefined は「指定なし」 */
export type TemplateTargetInput = {
  content?: string
  criteria?: string[]
  tagIds?: string[]
  priority?: TicketPriority
}

/**
 * 明示された項目を優先し、指定の無い項目だけをテンプレートで埋める(MCP の create_ticket)。
 * 優先度はテンプレートにも無ければ medium、タグは空にする(テンプレート無しの作成と同じ既定値)
 */
export const applyTicketTemplate = <T extends object>(
  input: T & TemplateTargetInput,
  template: TicketTemplateValues | null,
): T & Required<Pick<TemplateTargetInput, 'tagIds' | 'priority'>> => ({
  ...input,
  content: input.content ?? template?.content,
  criteria: input.criteria ?? template?.criteria,
  tagIds: input.tagIds ?? template?.tagIds ?? [],
  priority: input.priority ?? template?.priority ?? 'medium',
})

/** テンプレートの既定タグを、いまボードにあるタグへ絞る(削除されたタグは外部キーが無いので残っている) */
export const filterTemplateTagIds = (tagIds: string[], boardTagIds: Iterable<string>): string[] => {
  const existing = new Set(boardTagIds)
  return tagIds.filter((id) => existing.has(id))
}
