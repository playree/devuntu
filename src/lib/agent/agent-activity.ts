/**
 * ランナーの稼働判定(稼働許可時間帯 / 1日の処理上限 / 月の予算上限)(サーバー専用)
 */

import { addDaysDateOnly, addMonthsDateOnly, minToHHmm, nowDate, toZone, zonedMinutes } from '../day'
import { envu } from '../env-util'
import { type Db, prisma } from '../prisma'
import { AGENT_UNLIMITED_DAILY_RUNS } from './agent'
import type { AgentRunnerRow } from './agent-runner'

/** 稼働できない理由。ランナーとエージェントの双方へそのまま返す */
export type AgentInactiveReason = 'no_runner' | 'disabled' | 'outside_hours' | 'daily_limit' | 'monthly_budget'

type ActiveWindow = Pick<AgentRunnerRow, 'activeFromMin' | 'activeToMin' | 'timezone'>

/** 時間帯の判定に使うタイムゾーン。ランナーに未設定ならサーバーの既定(`DEFAULT_TIMEZONE`) */
const runnerTimezone = (window: Pick<AgentRunnerRow, 'timezone'>): string =>
  window.timezone ?? envu.server.DEFAULT_TIMEZONE

/**
 * 稼働許可時間帯の内側かどうか。
 *
 * 片方でも未設定、または開始と終了が同じ場合は終日とみなす。
 * 開始 > 終了(例 22:00〜06:00)は日跨ぎとして扱う。終了時刻ちょうどは含めない。
 */
export const isWithinActiveWindow = (window: ActiveWindow, now: Date = nowDate()): boolean => {
  const { activeFromMin: from, activeToMin: to } = window
  if (from === null || to === null || from === to) {
    return true
  }
  const zoned = toZone(now, runnerTimezone(window))
  const current = zoned.hour() * 60 + zoned.minute()
  return from < to ? current >= from && current < to : current >= from || current < to
}

/** 表示用の稼働時間帯。終日の場合は null */
export const activeWindowLabel = (window: ActiveWindow): { from: string; to: string; timezone: string } | null => {
  const { activeFromMin: from, activeToMin: to } = window
  if (from === null || to === null || from === to) {
    return null
  }
  return { from: minToHHmm(from), to: minToHHmm(to), timezone: runnerTimezone(window) }
}

/** 処理上限の消化状況。上限が無制限のときは持たない */
export type AgentRunUsage = { used: number; limit: number; resetAt: Date }

/** 予算の消化状況(USD)。予算が無制限のときは持たない */
export type AgentBudgetUsage = { usedUsd: number; limitUsd: number; resetAt: Date }

export type AgentActivity = {
  active: boolean
  reason: AgentInactiveReason | null
  usage?: AgentRunUsage | null
  budget?: AgentBudgetUsage | null
}

/** 稼働条件の判定。設定が無い(= 自動運用を使わない)場合も稼働不可として扱う */
export const evaluateRunner = (runner: AgentRunnerRow | null, now: Date = nowDate()): AgentActivity => {
  if (!runner) {
    return { active: false, reason: 'no_runner' }
  }
  if (!runner.enabled) {
    return { active: false, reason: 'disabled' }
  }
  if (!isWithinActiveWindow(runner, now)) {
    return { active: false, reason: 'outside_hours' }
  }
  return { active: true, reason: null }
}

type DailyWindow = Pick<AgentRunnerRow, 'dailyResetMin' | 'timezone'>

/**
 * 処理上限のカウント期間。暦日ではなくリセット時刻を境にする。
 *
 * リセット時刻前は前日ぶんの期間がまだ続いているとみなす。`resetAt` は次にカウントが
 * 0 に戻る時刻で、上限に達したときに「いつ再開するか」を伝えるために返す。
 */
export const dailyRunWindow = (window: DailyWindow, now: Date = nowDate()): { since: Date; resetAt: Date } => {
  const tz = runnerTimezone(window)
  const today = toZone(now, tz).format('YYYY-MM-DD')
  const todayReset = zonedMinutes(today, window.dailyResetMin, tz)
  const startDate = todayReset.valueOf() <= now.getTime() ? today : addDaysDateOnly(today, -1)
  return {
    since: zonedMinutes(startDate, window.dailyResetMin, tz).toDate(),
    resetAt: zonedMinutes(addDaysDateOnly(startDate, 1), window.dailyResetMin, tz).toDate(),
  }
}

/** カウント期間に開始した実行の数。失敗や見送りも起動した以上は数える */
export const countAgentRunsSince = async (db: Db, runnerId: string, since: Date): Promise<number> =>
  db.agentRun.count({ where: { runnerId, startedAt: { gte: since } } })

/** 処理上限の消化状況を算出する。上限チェックと実行作成の両方から使うので共通化している */
export const computeAgentRunUsage = async (db: Db, runner: AgentRunnerRow, now: Date): Promise<AgentRunUsage> => {
  const { since, resetAt } = dailyRunWindow(runner, now)
  const used = await countAgentRunsSince(db, runner.id, since)
  return { used, limit: runner.dailyRunLimit, resetAt }
}

/**
 * 予算の集計期間。暦月ではなく、毎月1日のリセット時刻(`dailyResetMin`)を境にする。
 *
 * 1日の処理上限と同じ時刻で切り替わるので、利用者が覚える境目は1つで済む。
 * `month` は `AgentUsage.month` のキー、`resetAt` は次に集計が 0 に戻る時刻。
 */
export const monthlyUsageWindow = (window: DailyWindow, now: Date = nowDate()): { month: string; resetAt: Date } => {
  const tz = runnerTimezone(window)
  const first = toZone(now, tz).format('YYYY-MM-01')
  const start =
    zonedMinutes(first, window.dailyResetMin, tz).valueOf() <= now.getTime() ? first : addMonthsDateOnly(first, -1)
  return {
    month: start.slice(0, 7),
    resetAt: zonedMinutes(addMonthsDateOnly(start, 1), window.dailyResetMin, tz).toDate(),
  }
}

/** その月のコストの合計(USD)。ボードが消えた行(boardId が null)も含める */
export const sumAgentCost = async (db: Db, runnerId: string, month: string): Promise<number> => {
  const { _sum } = await db.agentUsage.aggregate({ where: { runnerId, month }, _sum: { costUsd: true } })
  return _sum.costUsd?.toNumber() ?? 0
}

/** 予算の消化状況を算出する。上限チェックと実行作成の両方から使うので共通化している */
export const computeAgentBudgetUsage = async (db: Db, runner: AgentRunnerRow, now: Date): Promise<AgentBudgetUsage> => {
  const { month, resetAt } = monthlyUsageWindow(runner, now)
  return { usedUsd: await sumAgentCost(db, runner.id, month), limitUsd: runner.monthlyBudgetUsd.toNumber(), resetAt }
}

/** 月の予算上限を設けているか。0 は無制限 */
export const hasMonthlyBudget = (runner: Pick<AgentRunnerRow, 'monthlyBudgetUsd'>): boolean =>
  runner.monthlyBudgetUsd.gt(0)

/**
 * 稼働条件の判定に1日の処理上限と月の予算上限を加えたもの。DB を引くので非同期。
 *
 * 上限が無制限、または他の理由で既に稼働不可なら数えない(ポーリングのたびに引かせない)。
 * 予算は開始前にしか見ないので、実行中の1回ぶんは超過し得る(ソフトリミット)。
 */
export const evaluateRunnerActivity = async (
  runner: AgentRunnerRow | null,
  now: Date = nowDate(),
): Promise<AgentActivity> => {
  const activity = evaluateRunner(runner, now)
  if (!runner || !activity.active) {
    return activity
  }

  const limits: Pick<AgentActivity, 'usage' | 'budget'> = {}
  if (runner.dailyRunLimit > AGENT_UNLIMITED_DAILY_RUNS) {
    const usage = await computeAgentRunUsage(prisma, runner, now)
    if (usage.used >= usage.limit) {
      return { active: false, reason: 'daily_limit', usage }
    }
    limits.usage = usage
  }
  if (hasMonthlyBudget(runner)) {
    const budget = await computeAgentBudgetUsage(prisma, runner, now)
    if (budget.usedUsd >= budget.limitUsd) {
      return { active: false, reason: 'monthly_budget', ...limits, budget }
    }
    limits.budget = budget
  }
  return { active: true, reason: null, ...limits }
}
