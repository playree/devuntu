/**
 * AIエージェント(管理 / 承認 / 自動運用)の入力スキーマ
 */

import { el } from '@/locale'
import { z } from 'zod'
import {
  AGENT_HANDLE_PATTERN,
  AGENT_TASK_MODES,
  AGENT_TASK_STATES,
  AGENT_WINDOW_MAX_MIN,
  AGENT_WINDOW_STEP_MIN,
  MAX_AGENT_DAILY_LIMIT,
  MAX_POLL_INTERVAL_SEC,
  MIN_POLL_INTERVAL_SEC,
} from '../agent/agent'
import { TICKET_SORT_COLUMNS } from '../board/ticket-search'
import { TOKEN_EXPIRES } from '../token-expires'
import { zName, zPagingFields } from './schema'

/**
 * AIエージェントの識別子。メールアドレスのローカル部になるので `agentEmail` の形を崩さない値だけ許す。
 * 作成後は変更できない(既存本文のメンションが解決できなくなるため)。
 */
export const zAgentHandle = z.string().regex(AGENT_HANDLE_PATTERN, el('@invalid_agent_handle'))

export const scCreateAgent = z.object({
  name: zName,
  handle: zAgentHandle,
  groups: z.array(z.uuidv7()).default([]),
})
export type CreateAgent = z.infer<typeof scCreateAgent>
export type CreateAgentIn = z.input<typeof scCreateAgent>
export type CreateAgentOut = z.output<typeof scCreateAgent>

export const scUpdateAgent = z.object({
  id: z.uuidv7(),
  name: zName,
  groups: z.array(z.uuidv7()),
})
export type UpdateAgent = z.infer<typeof scUpdateAgent>

/** 承認ユーザーの追加・削除(1件ずつ、即時反映) */
export const scAgentApproverUser = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
})
export type AgentApproverUser = z.infer<typeof scAgentApproverUser>

/** 承認グループの総入れ替え。0 件を許す(= グループ経由の承認者が居なくなる) */
export const scSetAgentApproverGroups = z.object({
  id: z.uuidv7(),
  groupIds: z.array(z.uuidv7()),
})
export type SetAgentApproverGroups = z.infer<typeof scSetAgentApproverGroups>

export const scIssueAgentToken = z.object({
  userId: z.uuidv7(),
  expires: z.enum(TOKEN_EXPIRES),
})
export type IssueAgentToken = z.infer<typeof scIssueAgentToken>

/** チケットの処理方式。null は「選択待ち」(= エージェント処理の対象外) */
export const zAgentMode = z.enum(AGENT_TASK_MODES)

/** チケットの処理状態。null(未着手)は絞り込み側で queued と同一視する */
export const zAgentState = z.enum(AGENT_TASK_STATES)

/** 1日のうちの時刻。0:00 からの分(30分刻み) */
const zDayMin = z
  .number()
  .int()
  .multipleOf(AGENT_WINDOW_STEP_MIN, el('@invalid_time_range'))
  .min(0, el('@invalid_time_range'))
  .max(AGENT_WINDOW_MAX_MIN, el('@invalid_time_range'))

/** 稼働許可時間帯の時刻。null は指定なし(= 終日) */
const zWindowMin = zDayMin.nullable()

/**
 * 自動運用(Devuntu Agent)の設定。
 *
 * 稼働許可時間帯は開始・終了のどちらかが未指定なら終日として扱う(`isWithinActiveWindow`)。
 * 開始 > 終了は日跨ぎ(夜間のみ稼働)を表すため、大小関係の制約は掛けない。
 */
export const scSaveAgentRunner = z.object({
  userId: z.uuidv7(),
  enabled: z.boolean(),
  activeFromMin: zWindowMin,
  activeToMin: zWindowMin,
  /** 妥当性(IANA 名として解決できるか)は `saveAgentRunner` 側で見る */
  timezone: z.string().nullable(),
  pollIntervalSec: z.number().int().min(MIN_POLL_INTERVAL_SEC).max(MAX_POLL_INTERVAL_SEC),
  /** 1日に開始できる実行の上限。0 は無制限 */
  dailyRunLimit: z
    .number(el('@invalid_daily_limit'))
    .int(el('@invalid_daily_limit'))
    .min(0, el('@invalid_daily_limit'))
    .max(MAX_AGENT_DAILY_LIMIT, el('@invalid_daily_limit')),
  dailyResetMin: zDayMin,
})
export type SaveAgentRunner = z.infer<typeof scSaveAgentRunner>

export const scSaveAgentRunnerRule = z.object({
  userId: z.uuidv7(),
  rule: z.string().max(8000).nullable().optional(),
})
export type SaveAgentRunnerRule = z.infer<typeof scSaveAgentRunnerRule>

/**
 * 承認画面のチケット一覧。担当エージェントを軸に引くので、絞り込みは処理状態だけを持つ
 * (完了したチケットは承認の対象外なのでサーバー側で常に除外する)。
 * 並び順の扱いは {@link scTicketListQuery} と同じ。
 */
export const scAgentTicketListQuery = z.object({
  agentId: z.uuidv7(),
  /** 空配列 = 絞り込みなし。'queued' は agentState が null のチケットも含む */
  agentState: z.array(zAgentState).default([]),
  ...zPagingFields(TICKET_SORT_COLUMNS, 'updatedAt'),
})
export type AgentTicketListQuery = z.infer<typeof scAgentTicketListQuery>
export type AgentTicketListQueryIn = z.input<typeof scAgentTicketListQuery>
