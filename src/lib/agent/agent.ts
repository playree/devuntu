/**
 * AIエージェント用ユーザーの共通定義(クライアント / サーバー共用)
 *
 * トークンの生成・検証は prisma と `node:crypto` に依存するため `agent-token.ts` に分けてある。
 * 自動運用(Devuntu Agent)の判定ロジックも DB を引くので `agent-runner.ts` に分けてある。
 * ここはフォームのバリデーションや一覧表示からも読むので、純粋な値と関数だけを置くこと。
 */

import type { AgentRunAction, AgentRunStatus, AgentTaskMode, AgentTaskState } from '@/generated/prisma/enums'
import type { TicketWhereInput } from '@/generated/prisma/models'
import type { LocaleItemBase } from '@/locale'

/**
 * エージェントのメールアドレスに使うドメイン。
 *
 * `User.email` は better-auth の必須列であり、メンションの突き合わせキー(`resolveMentionUserIds`)
 * でもあるため、エージェントにもアドレスを持たせる必要がある。一方で実在アドレスを持たせると、
 * accountLinking により人間の Google / OIDC ログインがエージェントのユーザーへ吸い寄せられてしまう。
 * RFC 2606 の予約 TLD `.invalid` は名前解決されないので、その取り違えとメール誤送信の両方を防げる。
 */
export const AGENT_EMAIL_DOMAIN = 'agents.invalid'

/** 識別子。メールアドレスのローカル部になるので、記号は先頭末尾に置けないハイフンだけに絞る */
export const AGENT_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/

export const agentEmail = (handle: string): string => `${handle}@${AGENT_EMAIL_DOMAIN}`

export const agentHandle = (email: string): string | null => {
  const suffix = `@${AGENT_EMAIL_DOMAIN}`
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : null
}

/** 識別子の重複。Server Action は非同期関数しか export できないため定数はここに置く */
export const DUPLICATED_AGENT_HANDLE = 'DUPLICATED_AGENT_HANDLE'

/** トークンの有効期限の選択肢。`none` は無期限、それ以外は発行日からの日数 */
export const AGENT_TOKEN_EXPIRES = ['none', '30', '90', '180', '365'] as const
export type AgentTokenExpires = (typeof AGENT_TOKEN_EXPIRES)[number]

/** 選択肢を実際の有効期限へ変換する。無期限は null */
export const agentTokenExpiresAt = (value: AgentTokenExpires, from: Date): Date | null =>
  value === 'none' ? null : new Date(from.getTime() + Number(value) * 24 * 60 * 60 * 1000)

/* -------------------------------------------------------------------------------------------------
 * 自動運用(Devuntu Agent)
 * ---------------------------------------------------------------------------------------------- */

/** チケットの処理方式。定義順は選択肢の表示順になる */
export const AGENT_TASK_MODES = ['plan', 'auto'] as const satisfies readonly AgentTaskMode[]

export const AGENT_TASK_MODE_LOCALE = {
  plan: 'agent_mode_plan',
  auto: 'agent_mode_auto',
} as const satisfies Record<AgentTaskMode, LocaleItemBase>

/** チケットの処理状態。定義順は選択肢の表示順になる */
export const AGENT_TASK_STATES = [
  'queued',
  'running',
  'planned',
  'done',
  'failed',
  'skipped',
] as const satisfies readonly AgentTaskState[]

/** 完了(done)以外の処理状態。承認画面の絞り込み初期値に使う */
export const OPEN_AGENT_TASK_STATES = AGENT_TASK_STATES.filter((state) => state !== 'done')

/**
 * 処理状態による絞り込み条件。空配列は絞り込みなし。
 *
 * `agentState` が null のチケットは未着手(queued)として扱う(`agent-runner.ts` のポーリング条件と同じ規約)。
 */
export const agentStateWhere = (states: readonly AgentTaskState[]): TicketWhereInput => {
  if (states.length === 0) {
    return {}
  }
  return states.includes('queued')
    ? { OR: [{ agentState: null }, { agentState: { in: [...states] } }] }
    : { agentState: { in: [...states] } }
}

export const AGENT_TASK_STATE_LOCALE = {
  queued: 'agent_state_queued',
  running: 'agent_state_running',
  planned: 'agent_state_planned',
  done: 'agent_state_done',
  failed: 'agent_state_failed',
  skipped: 'agent_state_skipped',
} as const satisfies Record<AgentTaskState, LocaleItemBase>

export const AGENT_RUN_ACTION_LOCALE = {
  plan: 'agent_action_plan',
  execute: 'agent_action_execute',
  revise: 'agent_action_revise',
} as const satisfies Record<AgentRunAction, LocaleItemBase>

export const AGENT_RUN_STATUS_LOCALE = {
  running: 'agent_run_running',
  succeeded: 'agent_run_succeeded',
  failed: 'agent_run_failed',
  skipped: 'agent_run_skipped',
} as const satisfies Record<AgentRunStatus, LocaleItemBase>

/** ランナーへ返すポーリング間隔(秒)の既定値と許容範囲 */
export const DEFAULT_POLL_INTERVAL_SEC = 300
export const MIN_POLL_INTERVAL_SEC = 60
export const MAX_POLL_INTERVAL_SEC = 3600

/** 実行履歴として画面に出す最大件数。これより古い実行は一覧に現れない */
export const AGENT_RUN_HISTORY_LIMIT = 100

/** ポーリング間隔(秒)の選択肢 */
export const AGENT_POLL_INTERVAL_OPTIONS = [60, 180, 300, 600, 900, 1800, 3600]

/** 稼働許可時間帯の刻み(分)。選択肢と入力検証で共有する */
export const AGENT_WINDOW_STEP_MIN = 30

/** 稼働許可時間帯に指定できる最大値(23:30) */
export const AGENT_WINDOW_MAX_MIN = 24 * 60 - AGENT_WINDOW_STEP_MIN

/**
 * ランナーの状態。一覧の表示にだけ使う。
 *
 * `offline` はポーリング間隔の何倍まで待つかで決まる。1回の取りこぼしで落ちた扱いにしないよう
 * 余裕を持たせる。
 */
export const AGENT_OFFLINE_INTERVAL_FACTOR = 3

export type AgentRunnerStatus = 'none' | 'disabled' | 'online' | 'offline'

export const agentRunnerStatus = (
  runner: { enabled: boolean; pollIntervalSec: number; lastPolledAt: Date | null } | null,
  now: Date,
): AgentRunnerStatus => {
  if (!runner) {
    return 'none'
  }
  if (!runner.enabled) {
    return 'disabled'
  }
  const deadline = runner.pollIntervalSec * AGENT_OFFLINE_INTERVAL_FACTOR * 1000
  return runner.lastPolledAt && now.getTime() - runner.lastPolledAt.getTime() <= deadline ? 'online' : 'offline'
}
