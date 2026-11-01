/**
 * プランへの返信を待つべきかの判定。直近の実行(このエージェントのもの)とチケットの処理状態だけで決まる
 */

import { awaitsPlanReply } from '@/lib/agent/agent-plan-guard'
import { describe, expect, it } from 'vitest'

describe('awaitsPlanReply', () => {
  it.each([
    ['plan の実行中', { action: 'plan', status: 'running' }, 'running', true],
    ['plan を planned で閉じて返信待ち', { action: 'plan', status: 'succeeded' }, 'planned', true],
    ['直したプランを planned で閉じて返信待ち', { action: 'revise', status: 'succeeded' }, 'planned', true],
    ['返信を受けた revise の実行中', { action: 'revise', status: 'running' }, 'running', false],
    ['自動実行の実行中', { action: 'execute', status: 'running' }, 'running', false],
    ['plan が失敗で閉じた', { action: 'plan', status: 'failed' }, 'failed', false],
    ['報告済み', { action: 'execute', status: 'succeeded' }, 'done', false],
  ] as const)('%s → %s', (_label, latest, agentState, expected) => {
    expect(awaitsPlanReply(latest, agentState)).toBe(expected)
  })

  it('このエージェントが処理したことの無いチケットは対象外', () => {
    expect(awaitsPlanReply(null, 'planned')).toBe(false)
  })
})
