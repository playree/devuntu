/**
 * チケット / コメント / タグの入力スキーマ
 */

import { el } from '@/locale'
import { z } from 'zod'
import { MAX_TAG_NAME, MAX_TICKET_TAGS, TAG_COLORS } from '../board/tag-rule'
import {
  TICKET_COMMENT_DECISIONS,
  TICKET_COMMENT_TYPES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from '../board/ticket-enum'
import { parseTicketDisplayId } from '../board/ticket-id'
import {
  MAX_CHILD_ORDER,
  TICKET_CHILD_ADVANCES,
  TICKET_RELATION_FILTERS,
  TICKET_RELATION_KINDS,
} from '../board/ticket-relation-rule'
import { ASSIGNEE_NONE, TICKET_SORT_COLUMNS } from '../board/ticket-search'
import { looksLikeGitUrl } from '../git/git'
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

/**
 * チケットに紐付ける GitHub / GitLab のブランチ / PR(MR) / コミットの URL。種別の判定は parseGitUrl が行う。
 * GitLab は許可したインスタンス(サーバーの環境変数)かどうかをここでは見ず、登録時にサーバー側で判定する
 */
export const zGitUrl = z
  .string()
  .trim()
  .max(2000, el('@invalid_git_url'))
  .refine((url) => looksLikeGitUrl(url), el('@invalid_git_url'))

/** 期日は日付のみ(YYYY-MM-DD)。DatePickerCtrl が CalendarDate との変換を担う */
export const zDueDate = z.iso.date().nullish()

/** 1チケットに登録できる受け入れ条件の数 */
export const MAX_TICKET_CRITERIA = 20

/** 受け入れ条件1項目の文字数上限 */
export const MAX_CRITERION_TEXT = 500

export const zCriterionText = z
  .string()
  .trim()
  .min(1, el('@required_field'))
  .max(MAX_CRITERION_TEXT, el('@invalid_content'))

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
  /** 受け入れ条件の文言(空行は画面側で捨てる)。MCP は acceptanceCriteria で受ける */
  criteria: z.array(zCriterionText).max(MAX_TICKET_CRITERIA, el('@too_many_criteria')).optional(),
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
  /** 子が次の順番へ進む条件(親として持つ) */
  childAdvance: z.enum(TICKET_CHILD_ADVANCES).optional(),
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

/** 検索の「関係するチケット」。表示IDだけを受ける(ボードを跨いだ番号だけの指定は意味を持たない) */
export const zRelatedTo = z
  .string()
  .trim()
  .max(20, el('@invalid_display_id'))
  .refine((value) => value === '' || parseTicketDisplayId(value) !== null, el('@invalid_display_id'))

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
  /** 関係するチケットの表示ID。空文字は絞り込まない */
  relatedTo: zRelatedTo.default(''),
  /** relatedTo のチケットから見た関係。child = 直下の子 / related = 関連 / all = 両方 */
  relation: z.enum(TICKET_RELATION_FILTERS).default('all'),
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

/**
 * plan / report への承認・差し戻し。本文は画面側で組み立てる(承認は定型文 + 補足、差し戻しは理由)。
 * 返信先は対象コメントから決まるので parentId は受け取らない
 */
export const scDecideAgentComment = z.object({
  commentId: z.uuidv7(),
  decision: z.enum(TICKET_COMMENT_DECISIONS),
  content: zCommentContent,
})
export type DecideAgentComment = z.infer<typeof scDecideAgentComment>

/** エージェントが自己申告に添える根拠 */
export const zCriterionEvidence = z.string().trim().min(1).max(1000)

/** 受け入れ条件ごとの自己申告(MCP の finish_agent_task / report_acceptance_criteria で共通) */
export const zCriterionReports = (idDescription: string) =>
  z
    .array(
      z.object({
        id: z.uuidv7().describe(idDescription),
        met: z.boolean().describe('Whether the criterion is met'),
        evidence: zCriterionEvidence.describe(
          'Evidence for the judgment (what was checked, test results, relevant code, etc.)',
        ),
      }),
    )
    .max(MAX_TICKET_CRITERIA)

/**
 * 受け入れ条件の一覧(全件の置き換え)。既存の項目は id を付けて渡すと確認状態を引き継ぐ。
 * id の無い項目は新規として作る
 */
export const zCriterionItems = z
  .array(z.object({ id: z.uuidv7().optional(), text: zCriterionText }))
  .max(MAX_TICKET_CRITERIA, el('@too_many_criteria'))
export type CriterionItem = z.infer<typeof zCriterionItems>[number]

export const scSaveTicketCriteria = z.object({
  ticketId: z.uuidv7(),
  items: zCriterionItems,
})
export type SaveTicketCriteria = z.infer<typeof scSaveTicketCriteria>

/** 受け入れ条件の人による確認(チェック)の切り替え */
export const scCheckTicketCriterion = z.object({
  id: z.uuidv7(),
  checked: z.boolean(),
})
export type CheckTicketCriterion = z.infer<typeof scCheckTicketCriterion>

/** 親の下での子の順番。同じ値の子は番号順に並ぶ */
export const zChildOrder = z.number().int().min(1).max(MAX_CHILD_ORDER)

/** 関係の相手。チケットID / 表示ID / 番号(`12` / `#12`)を受け、同じボードの中から引く */
export const zRelationTarget = z.string().trim().min(1, el('@required_field')).max(50, el('@invalid_display_id'))

/** 関係の追加。kind は操作するチケットから見た相手の立場(相手を親にする / 子にする / 関連付ける) */
export const scAddTicketRelation = z.object({
  ticketId: z.uuidv7(),
  target: zRelationTarget,
  kind: z.enum(TICKET_RELATION_KINDS),
})
export type AddTicketRelation = z.infer<typeof scAddTicketRelation>

/** 関係の相手の候補検索。keyword は表示ID / 番号 / 件名。空文字なら最近更新されたチケット */
export const scSearchRelationCandidates = z.object({
  ticketId: z.uuidv7(),
  keyword: z.string().trim().max(100).default(''),
})
export type SearchRelationCandidates = z.infer<typeof scSearchRelationCandidates>

/** 一覧の「関係するチケット」の候補検索。boardId が null なら可視ボード全体 */
export const scSearchTicketCandidates = z.object({
  keyword: z.string().trim().max(100).default(''),
  boardId: z.uuidv7().nullish(),
})
export type SearchTicketCandidates = z.infer<typeof scSearchTicketCandidates>

/** 子を兄弟の中で 1 つ前(-1) / 後(1)へ動かす。id は親子の関係の ID */
export const scMoveTicketChild = z.object({
  id: z.uuidv7(),
  offset: z.union([z.literal(-1), z.literal(1)]),
})
export type MoveTicketChild = z.infer<typeof scMoveTicketChild>

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

/** ブランチ / PR / コミットの紐付け */
export const scAddTicketLink = z.object({
  ticketId: z.uuidv7(),
  url: zGitUrl,
})
export type AddTicketLink = z.infer<typeof scAddTicketLink>

/** 1つの起票案に含められる子チケットの数 */
export const MAX_PROPOSED_CHILDREN = 20

/**
 * エージェントの plan に付ける子チケットの起票案。承認すると子チケットとして起票される。
 * `TicketComment.proposal`(Json)に保存し、読むときもこのスキーマで検証する
 */
export const zChildProposal = z.object({
  children: z
    .array(
      z.object({
        title: zTicketTitle.describe('Title of the child ticket'),
        content: zTicketContent.optional().describe('Description of the child ticket (Markdown)'),
        order: zChildOrder.describe(
          'Order under the parent (1-based). A child waits until every sibling with a smaller order is settled; siblings with the same order run in parallel',
        ),
        mode: zAgentMode
          .nullable()
          .describe(
            'How the agent processes the child. plan=post a plan first / auto=execute directly / null=leave it to a human (unassigned)',
          ),
        acceptanceCriteria: z
          .array(zCriterionText)
          .max(MAX_TICKET_CRITERIA)
          .default([])
          .describe('Acceptance criteria of the child, one verifiable sentence per item'),
      }),
    )
    .min(1)
    .max(MAX_PROPOSED_CHILDREN),
  advance: z
    .enum(TICKET_CHILD_ADVANCES)
    .optional()
    .describe(
      'When a child may move on to the next order. done=when the previous siblings are done / reported=also when the agent has reported them. ' +
        "Follow the instructions in the ticket or the conversation. Omit to keep the parent's current setting (childAdvance in get_ticket)",
    ),
})
export type ChildProposal = z.infer<typeof zChildProposal>

/** 保存済みの起票案を読む。形が崩れていれば null(起票の対象にしない) */
export const parseChildProposal = (value: unknown): ChildProposal | null => {
  if (value === null || value === undefined) {
    return null
  }
  const parsed = zChildProposal.safeParse(value)
  return parsed.success ? parsed.data : null
}
