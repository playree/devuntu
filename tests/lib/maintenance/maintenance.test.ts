/**
 * メンテナンスの定数と保持期間の計算の単体テスト
 *
 * 定数はDBもストレージも触らずに検証できる。値そのものより、
 * 壊れると掃除の意味が変わってしまう関係を固定するのが目的。
 */

import { AGENT_RUN_HISTORY_LIMIT } from '@/lib/agent/agent'
import {
  AGENT_RUN_KEEP_PER_RUNNER,
  AGENT_RUN_RETENTION_MS,
  ATTACHMENT_DELETE_MAX,
  ATTACHMENT_SCAN_BATCH,
  ATTACHMENT_SWEEP_INTERVAL_MS,
  MAINTENANCE_TICK_MS,
  OAUTH_TOKEN_RETENTION_MS,
  retentionBefore,
  SESSION_RETENTION_MS,
  VERIFICATION_RETENTION_MS,
} from '@/lib/maintenance/maintenance'
import { describe, expect, it } from 'vitest'

const now = new Date('2026-09-08T10:00:00.000Z')

describe('retentionBefore: 保持期間の境界', () => {
  it('保持期間ぶん過去の時刻を返す', () => {
    expect(retentionBefore(now, 24 * 60 * 60 * 1000).toISOString()).toBe('2026-09-07T10:00:00.000Z')
  })

  it('0 なら現在時刻のまま(猶予なしの手順で使う)', () => {
    expect(retentionBefore(now, 0).getTime()).toBe(now.getTime())
  })

  it('元の Date を書き換えない', () => {
    retentionBefore(now, 1000)
    expect(now.toISOString()).toBe('2026-09-08T10:00:00.000Z')
  })
})

describe('定数の関係', () => {
  it('DBに残す実行履歴は画面が出せる件数を必ず上回る', () => {
    // 下回ると「一覧に出ているのに実体が無い」件が生まれる
    expect(AGENT_RUN_KEEP_PER_RUNNER).toBeGreaterThan(AGENT_RUN_HISTORY_LIMIT)
  })

  it('添付の掃除間隔は tick 以上(tick ごとに全走査しない)', () => {
    expect(ATTACHMENT_SWEEP_INTERVAL_MS).toBeGreaterThanOrEqual(MAINTENANCE_TICK_MS)
  })

  it('1周の削除上限は1ページの走査件数を超えない', () => {
    expect(ATTACHMENT_DELETE_MAX).toBeLessThanOrEqual(ATTACHMENT_SCAN_BATCH)
  })

  it('保持期間はすべて正の値', () => {
    for (const ms of [
      SESSION_RETENTION_MS,
      VERIFICATION_RETENTION_MS,
      OAUTH_TOKEN_RETENTION_MS,
      AGENT_RUN_RETENTION_MS,
    ]) {
      expect(ms).toBeGreaterThan(0)
    }
  })
})
