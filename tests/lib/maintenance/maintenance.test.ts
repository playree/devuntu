/**
 * メンテナンスの定数と保持期間の計算の単体テスト
 *
 * 定数はDBもストレージも触らずに検証できる。値そのものより、
 * 壊れると掃除の意味が変わってしまう関係を固定するのが目的。
 */

import {
  ATTACHMENT_DELETE_MAX,
  ATTACHMENT_SCAN_BATCH,
  ATTACHMENT_SWEEP_INTERVAL_MS,
  MAINTENANCE_TICK_MS,
  OAUTH_TOKEN_RETENTION_MS,
  SESSION_RETENTION_MS,
  VERIFICATION_RETENTION_MS,
} from '@/lib/maintenance/maintenance'
import { describe, expect, it } from 'vitest'

describe('定数の関係', () => {
  it('添付の掃除間隔は tick 以上(tick ごとに全走査しない)', () => {
    expect(ATTACHMENT_SWEEP_INTERVAL_MS).toBeGreaterThanOrEqual(MAINTENANCE_TICK_MS)
  })

  it('1周の削除上限は1ページの走査件数を超えない', () => {
    expect(ATTACHMENT_DELETE_MAX).toBeLessThanOrEqual(ATTACHMENT_SCAN_BATCH)
  })

  it('保持期間はすべて正の値', () => {
    for (const ms of [SESSION_RETENTION_MS, VERIFICATION_RETENTION_MS, OAUTH_TOKEN_RETENTION_MS]) {
      expect(ms).toBeGreaterThan(0)
    }
  })
})
