/**
 * エージェントの識別子とメールアドレスの対応。
 *
 * 生成したアドレスは `User.email` としてそのまま保存され、本文のメンション
 * (`@[アドレス]`)の突き合わせキーにもなるため、形が崩れないことを固定する。
 */

import {
  AGENT_EMAIL_DOMAIN,
  AGENT_HANDLE_PATTERN,
  AGENT_OFFLINE_INTERVAL_FACTOR,
  agentEmail,
  agentHandle,
  agentRunDuration,
  agentRunnerStatus,
  agentStateWhere,
  OPEN_AGENT_TASK_STATES,
} from '@/lib/agent/agent'
import { zEmail } from '@/lib/schema/schema'
import { describe, expect, it } from 'vitest'

describe('AGENT_HANDLE_PATTERN', () => {
  // 32文字は上限(先頭1 + 中間30 + 末尾1)
  it.each(['a', 'a1', 'review-bot', 'bot-1-2', '01234567890123456789012345678901'])('%s は許可する', (handle) => {
    expect(AGENT_HANDLE_PATTERN.test(handle)).toBe(true)
  })

  it.each([
    '',
    '-bot',
    'bot-',
    'Bot',
    'bot_1',
    'bot.1',
    'bot 1',
    'ボット',
    'bot@example.com',
    '012345678901234567890123456789012',
  ])('%s は拒否する', (handle) => {
    expect(AGENT_HANDLE_PATTERN.test(handle)).toBe(false)
  })
})

describe('agentEmail / agentHandle', () => {
  it('識別子から予約ドメインのアドレスを作る', () => {
    expect(agentEmail('review-bot')).toBe(`review-bot@${AGENT_EMAIL_DOMAIN}`)
  })

  it('アドレスから識別子へ戻せる', () => {
    expect(agentHandle(agentEmail('review-bot'))).toBe('review-bot')
  })

  it('エージェント以外のアドレスは null', () => {
    expect(agentHandle('someone@example.com')).toBeNull()
  })

  it('生成したアドレスはメールアドレスの検証を通る', () => {
    expect(zEmail.safeParse(agentEmail('review-bot')).success).toBe(true)
  })
})

describe('agentRunnerStatus', () => {
  const now = new Date('2026-01-01T12:00:00.000Z')
  const runner = (override: Record<string, unknown> = {}) => ({
    enabled: true,
    pollIntervalSec: 300,
    lastPolledAt: null as Date | null,
    ...override,
  })

  it('設定が無ければ未設定', () => {
    expect(agentRunnerStatus(null, now)).toBe('none')
  })

  it('無効なら停止中(最後のポーリングが新しくても変わらない)', () => {
    expect(agentRunnerStatus(runner({ enabled: false, lastPolledAt: now }), now)).toBe('disabled')
  })

  it('一度もポーリングが無ければオフライン', () => {
    expect(agentRunnerStatus(runner(), now)).toBe('offline')
  })

  it('ポーリング間隔の許容倍数までは稼働中', () => {
    const within = new Date(now.getTime() - 300 * AGENT_OFFLINE_INTERVAL_FACTOR * 1000)
    expect(agentRunnerStatus(runner({ lastPolledAt: within }), now)).toBe('online')
  })

  it('許容を過ぎたらオフライン', () => {
    const stale = new Date(now.getTime() - (300 * AGENT_OFFLINE_INTERVAL_FACTOR + 1) * 1000)
    expect(agentRunnerStatus(runner({ lastPolledAt: stale }), now)).toBe('offline')
  })
})

/**
 * 承認画面の処理状態による絞り込み。
 *
 * `Ticket.agentState` は nullable で null は未着手(queued)と同じ扱いのため、
 * queued を選んだときに null 行が落ちないことを固定する。
 */
describe('agentStateWhere', () => {
  it('空配列は絞り込みなし', () => {
    expect(agentStateWhere([])).toEqual({})
  })

  it('queued を含むと agentState が null のチケットも対象になる', () => {
    expect(agentStateWhere(['queued', 'running'])).toEqual({
      OR: [{ agentState: null }, { agentState: { in: ['queued', 'running'] } }],
    })
  })

  it('queued を含まなければ指定した状態だけを引く', () => {
    expect(agentStateWhere(['done'])).toEqual({ agentState: { in: ['done'] } })
  })

  it('初期値(完了以外)は null 行を含み done を含まない', () => {
    expect(agentStateWhere(OPEN_AGENT_TASK_STATES)).toEqual({
      OR: [{ agentState: null }, { agentState: { in: ['queued', 'running', 'planned', 'failed', 'skipped'] } }],
    })
  })
})

describe('agentRunDuration: 実行の所要時間', () => {
  const startedAt = new Date('2026-08-25T00:00:00Z')

  it('未終了は - を返す(実行中、または応答が返らないまま落ちた実行)', () => {
    expect(agentRunDuration(startedAt, null)).toBe('-')
  })

  it.each([
    [0, '00:00'],
    [59_000, '00:59'],
    [90_000, '01:30'],
    [3600_000, '60:00'],
  ])('mm:ss で出す(%s ミリ秒 -> %s)', (ms, expected) => {
    expect(agentRunDuration(startedAt, new Date(startedAt.getTime() + ms))).toBe(expected)
  })

  it('終了が開始より前でも負の時間にしない', () => {
    expect(agentRunDuration(startedAt, new Date(startedAt.getTime() - 5_000))).toBe('00:00')
  })
})
