/**
 * チケット / コメント / タグの入力スキーマ
 */

import { el } from '@/locale'
import { z } from 'zod'
import { MAX_TAG_NAME, MAX_TICKET_TAGS, TAG_COLORS } from '../board/tag-rule'
import { TICKET_COMMENT_TYPES, TICKET_PRIORITIES, TICKET_STATUSES } from '../board/ticket-enum'
import { ASSIGNEE_NONE, TICKET_SORT_COLUMNS } from '../board/ticket-search'
import { zPagingFields } from './schema'
import { zAgentMode } from './schema-agent'

/*
 * InputCtrl の constraintSchema は z.ZodObject を要求するため、
 * `.refine()` / `.and()` は使わず `z.object` / `.extend()` / `.omit()` で組み立てる。
 */

export const zTicketTitle = z.string().trim().min(1, el('@required_field')).max(120, el('@invalid_title'))
export const zTicketContent = z.string().max(40000, el('@invalid_content'))

/** タグ名。表示用の文字列。検索条件でも使う */
export const zTagName = z.string().trim().min(1, el('@invalid_tag')).max(MAX_TAG_NAME, el('@invalid_tag'))

/** タグの色。TAG_COLORS(tag-rule.ts) を単一ソースにする */
export const zTagColor = z.enum(TAG_COLORS)

/** タグの表示順 */
export const zTagOrder = z.number().int().min(0).max(999)

/** チケットへ付けるタグ。名前配列との取り違えを型で防ぐためフィールド名も tagIds にする */
export const zTagIds = z.array(z.uuidv7()).max(MAX_TICKET_TAGS, el('@invalid_tag'))

/** ステータス / 優先度は ticket-enum.ts を単一ソースにする(Prisma の enum とはそちらで突き合わせる) */
export const zTicketStatus = z.enum(TICKET_STATUSES)
export const zTicketPriority = z.enum(TICKET_PRIORITIES)
export const zCommentContent = z.string().trim().min(1, el('@required_field')).max(40000, el('@invalid_content'))

/** コメントの種別。ticket-enum.ts の TICKET_COMMENT_TYPES を単一ソースにする。null/未指定は通常コメント */
export const zCommentType = z.enum(TICKET_COMMENT_TYPES).nullish()

/** 期日は日付のみ(YYYY-MM-DD)。DatePickerCtrl が CalendarDate との変換を担う */
export const zDueDate = z.iso.date().nullish()

export const scCreateTicket = z.object({
  // プライベートも必ずボードに属するため必須。既定値はプライベートボード
  boardId: z.uuidv7(),
  title: zTicketTitle,
  content: zTicketContent.optional(),
  status: zTicketStatus.default('todo'),
  // 必須。未指定は medium(クリア不可のため UI からは null が飛ばない)
  priority: zTicketPriority.default('medium'),
  dueDate: zDueDate,
  tagIds: zTagIds.default([]),
  assigneeId: z.uuidv7().nullish(),
})
export type CreateTicket = z.infer<typeof scCreateTicket>
export type CreateTicketIn = z.input<typeof scCreateTicket>
export type CreateTicketOut = z.output<typeof scCreateTicket>

/**
 * チケットの部分更新(詳細画面のインライン編集)。
 *
 * 渡された項目だけを更新する。status はレーン順の再採番を伴うため scUpdateTicketStatus 側で扱う。
 * z.object で組むので constraintSchema へも渡せる(.optional() は getFieldConstraints が剥がす)。
 */
export const scPatchTicket = z.object({
  id: z.uuidv7(),
  title: zTicketTitle.optional(),
  content: zTicketContent.optional(),
  priority: zTicketPriority.optional(),
  /** undefined = 変更しない / null = クリア(zDueDate は nullish) */
  dueDate: zDueDate,
  tagIds: zTagIds.optional(),
  /** undefined = 変更しない / null = 未割り当てへ */
  assigneeId: z.uuidv7().nullish(),
})
export type PatchTicket = z.infer<typeof scPatchTicket>
export type PatchTicketIn = z.input<typeof scPatchTicket>

/**
 * エージェントモードの変更。承認者だけが行えるため patchTicket から切り出してある。
 * null は「選択待ち」(= エージェント処理の対象外)。
 */
export const scUpdateTicketAgentMode = z.object({
  id: z.uuidv7(),
  agentMode: zAgentMode.nullable(),
})
export type UpdateTicketAgentMode = z.infer<typeof scUpdateTicketAgentMode>

export const scUpdateTicketStatus = z.object({
  id: z.uuidv7(),
  status: zTicketStatus,
})
export type UpdateTicketStatus = z.infer<typeof scUpdateTicketStatus>

export const scMoveTicket = z.object({
  id: z.uuidv7(),
  status: zTicketStatus,
  /** 移動先レーン内の 0 始まりの挿入位置 */
  index: z.number().int().min(0),
})
export type MoveTicket = z.infer<typeof scMoveTicket>

export const scTicketSearch = z.object({
  keyword: z.string().trim().max(100).default(''),
  status: z.array(zTicketStatus).default([]),
  priority: z.array(zTicketPriority).default([]),
  /** タグは名前で絞り込む。ボード横断時に同名タグが分裂しないようにするため */
  tags: z.array(zTagName).max(MAX_TICKET_TAGS).default([]),
  /** null = 可視ボード全体。プライベートも 1 つのボードとして指定する */
  boardId: z.uuidv7().nullish(),
  /** null = すべて / 'none' = 未割り当て / それ以外は userId(KanbanFilter.assignee と同じ規約) */
  assignee: z.union([z.literal(ASSIGNEE_NONE), z.uuidv7()]).nullish(),
})
export type TicketSearch = z.infer<typeof scTicketSearch>
export type TicketSearchIn = z.input<typeof scTicketSearch>

/**
 * チケット一覧の問い合わせ条件。検索条件にページングと並び順を足したもの。
 *
 * 検索パネルは scTicketSearch だけを扱うため、ページング項目は別スキーマとして分けている。
 */
export const scTicketListQuery = scTicketSearch.extend(zPagingFields(TICKET_SORT_COLUMNS, 'updatedAt'))
export type TicketListQuery = z.infer<typeof scTicketListQuery>
export type TicketListQueryIn = z.input<typeof scTicketListQuery>

export const scCreateTicketComment = z.object({
  ticketId: z.uuidv7(),
  content: zCommentContent,
  /** plan/report を選べる。未指定/null は通常コメント */
  type: zCommentType,
  /** 返信先コメントID。1階層のみ許容(サーバー側で親が返信でないか検証する) */
  parentId: z.uuidv7().nullish(),
})
export type CreateTicketComment = z.infer<typeof scCreateTicketComment>

export const scUpdateTicketComment = z.object({
  id: z.uuidv7(),
  content: zCommentContent,
})
export type UpdateTicketComment = z.infer<typeof scUpdateTicketComment>

/** タグはボードに属する。プライベートタグもプライベートボードの boardId を指定する */
export const scCreateTag = z.object({
  boardId: z.uuidv7(),
  name: zTagName,
  color: zTagColor.default('gray'),
  /** 未指定は末尾へ採番する。0 を明示した場合は 0 のまま扱うため既定値は持たせない */
  order: zTagOrder.optional(),
})
export type CreateTag = z.infer<typeof scCreateTag>
export type CreateTagIn = z.input<typeof scCreateTag>
export type CreateTagOut = z.output<typeof scCreateTag>

export const scUpdateTag = z.object({
  id: z.uuidv7(),
  name: zTagName,
  color: zTagColor,
  order: zTagOrder,
})
export type UpdateTag = z.infer<typeof scUpdateTag>
export type UpdateTagIn = z.input<typeof scUpdateTag>
export type UpdateTagOut = z.output<typeof scUpdateTag>
