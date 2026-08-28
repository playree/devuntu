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
  agentRunnerStatus,
  agentTokenExpiresAt,
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

describe('agentTokenExpiresAt', () => {
  const from = new Date('2026-01-01T00:00:00.000Z')

  it('none は無期限(null)', () => {
    expect(agentTokenExpiresAt('none', from)).toBeNull()
  })

  it('日数ぶん先の日時を返す', () => {
    expect(agentTokenExpiresAt('30', from)?.toISOString()).toBe('2026-01-31T00:00:00.000Z')
    expect(agentTokenExpiresAt('365', from)?.toISOString()).toBe('2027-01-01T00:00:00.000Z')
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
