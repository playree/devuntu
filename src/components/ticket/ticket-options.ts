'use client'

/**
 * チケットの列挙値(ステータス / 優先度 / エージェントの処理状態)の Chip と選択肢の元になる map と、
 * 選択肢・表示名のフック
 */

import { createEnumChip, type EnumChipMap } from '@/components/enum-chip'
import type { AgentTaskState, BoardKind, TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import { AGENT_TASK_MODE_LOCALE, AGENT_TASK_MODES, AGENT_TASK_STATE_LOCALE } from '@/lib/agent/agent'
import { TICKET_PRIORITY_LOCALE, TICKET_STATUS_LOCALE } from '@/lib/board/ticket-enum'
import { useLocale } from '@/locale/client'
import { useCallback } from 'react'

/**
 * ステータスのロケールキーと Chip の表示色。
 * color は Chip 用の HeroUI セマンティック名なので bg-* には使えない(配色は ticket-style.ts の statusStyles を参照)。
 */
const STATUS_STYLE: EnumChipMap<TicketStatus> = {
  backlog: { item: TICKET_STATUS_LOCALE.backlog, color: 'default' },
  todo: { item: TICKET_STATUS_LOCALE.todo, color: 'accent' },
  doing: { item: TICKET_STATUS_LOCALE.doing, color: 'warning' },
  done: { item: TICKET_STATUS_LOCALE.done, color: 'success' },
}

/**
 * 優先度のロケールキーと Chip の表示色。
 * color は Chip 用の HeroUI セマンティック名なので bg-* には使えない(配色は ticket-style.ts の priorityStyles を参照)。
 * キーの並びは選択肢(useTicketOptions)の表示順になるので、優先度の高い順に保つこと。
 */
const PRIORITY_META: EnumChipMap<TicketPriority> = {
  urgent: { item: TICKET_PRIORITY_LOCALE.urgent, color: 'danger' },
  high: { item: TICKET_PRIORITY_LOCALE.high, color: 'warning' },
  medium: { item: TICKET_PRIORITY_LOCALE.medium, color: 'accent' },
  low: { item: TICKET_PRIORITY_LOCALE.low, color: 'default' },
}

/** `planned`(返信待ち)は利用者の操作を促す状態なので、完了 / 失敗とは別の色にする */
const AGENT_STATE_STYLE: EnumChipMap<AgentTaskState> = {
  queued: { item: AGENT_TASK_STATE_LOCALE.queued, color: 'default' },
  running: { item: AGENT_TASK_STATE_LOCALE.running, color: 'accent' },
  planned: { item: AGENT_TASK_STATE_LOCALE.planned, color: 'warning' },
  done: { item: AGENT_TASK_STATE_LOCALE.done, color: 'success' },
  failed: { item: AGENT_TASK_STATE_LOCALE.failed, color: 'danger' },
  skipped: { item: AGENT_TASK_STATE_LOCALE.skipped, color: 'default' },
}

export const statusChip = createEnumChip(STATUS_STYLE)
export const priorityChip = createEnumChip(PRIORITY_META)
export const agentStateChip = createEnumChip(AGENT_STATE_STYLE)

/**
 * ボードの表示名を解決する。
 * プライベートボードは DB 上の name が固定値(PRIVATE_BOARD_NAME)なので、
 * ユーザーの言語設定に追従させるためロケールへ差し替える。
 */
export const useBoardName = () => {
  const { t } = useLocale()
  return useCallback(
    (board: { name: string; kind: BoardKind }) => (board.kind === 'private' ? t('private') : board.name),
    [t],
  )
}

/** ステータス / 優先度の選択肢(Record<id, label>)。SingleSelectCtrl へ渡す */
export const useTicketOptions = () => ({
  statusOptions: statusChip.useOptions(),
  priorityOptions: priorityChip.useOptions(),
})

/** 「エージェントに任せない」を表すセンチネル。Select は null を選択肢に持てないので値で表す */
export const AGENT_MODE_NONE = 'none'

/** エージェントの処理方式の選択肢。先頭は「任せない」(= agentMode を null に戻す) */
export const useAgentModeOptions = (): Record<string, string> => {
  const { t } = useLocale()
  return {
    [AGENT_MODE_NONE]: t('agent_mode_none'),
    ...Object.fromEntries(AGENT_TASK_MODES.map((mode) => [mode, t(AGENT_TASK_MODE_LOCALE[mode])])),
  }
}

/** 処理状態の選択肢(Record<id, label>)。AgentStateChip と同じ文言を絞り込みへ渡す */
export const useAgentStateOptions = agentStateChip.useOptions
