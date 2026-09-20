/**
 * 環境変数の読み取りの単体テスト
 *
 * 値の綴り違いが不可逆な操作へ落ちないことを確認する。
 */

import { AGENT_RUN_HISTORY_LIMIT } from '@/lib/agent/agent'
import { envu } from '@/lib/env-util'
import { afterEach, describe, expect, it } from 'vitest'

const original = process.env.MAINTENANCE_ATTACHMENT_MODE

afterEach(() => {
  if (original === undefined) {
    delete process.env.MAINTENANCE_ATTACHMENT_MODE
  } else {
    process.env.MAINTENANCE_ATTACHMENT_MODE = original
  }
})

describe('MAINTENANCE_ATTACHMENT_MODE', () => {
  it('未設定なら delete', () => {
    delete process.env.MAINTENANCE_ATTACHMENT_MODE
    expect(envu.server.MAINTENANCE_ATTACHMENT_MODE).toBe('delete')
  })

  it.each(['off', 'dry-run', 'delete'])('許可された値はそのまま返す (%s)', (value) => {
    process.env.MAINTENANCE_ATTACHMENT_MODE = value
    expect(envu.server.MAINTENANCE_ATTACHMENT_MODE).toBe(value)
  })

  it('綴り違いは起動時に弾く', () => {
    // 黙って既定へ倒すと、止めたつもりの設定で実体が消える
    process.env.MAINTENANCE_ATTACHMENT_MODE = 'dry_run'
    expect(() => envu.server.MAINTENANCE_ATTACHMENT_MODE).toThrow()
  })
})

describe('SEARCH_ENGINE_INDEXING', () => {
  const originalIndexing = process.env.SEARCH_ENGINE_INDEXING

  afterEach(() => {
    if (originalIndexing === undefined) {
      delete process.env.SEARCH_ENGINE_INDEXING
    } else {
      process.env.SEARCH_ENGINE_INDEXING = originalIndexing
    }
  })

  it('未設定なら false', () => {
    // 設定を書き忘れた環境が検索結果へ載らないよう、既定はインデックス拒否側に倒す
    delete process.env.SEARCH_ENGINE_INDEXING
    expect(envu.server.SEARCH_ENGINE_INDEXING).toBe(false)
  })

  it('true でインデックスを許可する', () => {
    process.env.SEARCH_ENGINE_INDEXING = 'true'
    expect(envu.server.SEARCH_ENGINE_INDEXING).toBe(true)
  })

  it('false でインデックスを拒否する', () => {
    process.env.SEARCH_ENGINE_INDEXING = 'false'
    expect(envu.server.SEARCH_ENGINE_INDEXING).toBe(false)
  })

  it.each(['TRUE', 'False'])('大文字小文字は問わない (%s)', (value) => {
    process.env.SEARCH_ENGINE_INDEXING = value
    expect(envu.server.SEARCH_ENGINE_INDEXING).toBe(value.toLowerCase() === 'true')
  })

  it('空文字は未設定と同じ扱い', () => {
    process.env.SEARCH_ENGINE_INDEXING = ''
    expect(envu.server.SEARCH_ENGINE_INDEXING).toBe(false)
  })

  it.each(['ture', '1', 'yes', 'on'])('綴り違いは起動時に弾く (%s)', (value) => {
    // 黙って true 側へ倒すと、社内向けに立てた環境が検索結果へ載る
    process.env.SEARCH_ENGINE_INDEXING = value
    expect(() => envu.server.SEARCH_ENGINE_INDEXING).toThrow()
  })
})

describe('TWO_FA_REQUIRED', () => {
  const originalTwoFa = process.env.TWO_FA_REQUIRED

  afterEach(() => {
    if (originalTwoFa === undefined) {
      delete process.env.TWO_FA_REQUIRED
    } else {
      process.env.TWO_FA_REQUIRED = originalTwoFa
    }
  })

  it('未設定なら true', () => {
    delete process.env.TWO_FA_REQUIRED
    expect(envu.server.TWO_FA_REQUIRED).toBe(true)
  })

  it('false で無効になる', () => {
    process.env.TWO_FA_REQUIRED = 'false'
    expect(envu.server.TWO_FA_REQUIRED).toBe(false)
  })

  it('綴り違いは起動時に弾く', () => {
    // 既定が true の変数でも、黙って既定へ倒すと止めたつもりの 2FA が有効なままになる
    process.env.TWO_FA_REQUIRED = 'flase'
    expect(() => envu.server.TWO_FA_REQUIRED).toThrow()
  })
})

/** 実行履歴の保持は運用者が変える値なので、読み取りのたびに元へ戻す */
const restoreEnv = (key: string): void => {
  const before = process.env[key]
  afterEach(() => {
    if (before === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = before
    }
  })
}

describe('AGENT_RUN_RETENTION_DAYS / COMMAND_RUN_RETENTION_DAYS', () => {
  restoreEnv('AGENT_RUN_RETENTION_DAYS')
  restoreEnv('COMMAND_RUN_RETENTION_DAYS')

  it('未設定なら90日', () => {
    delete process.env.AGENT_RUN_RETENTION_DAYS
    delete process.env.COMMAND_RUN_RETENTION_DAYS
    expect(envu.server.AGENT_RUN_RETENTION_DAYS).toBe(90)
    expect(envu.server.COMMAND_RUN_RETENTION_DAYS).toBe(90)
  })

  it('設定した日数を返す', () => {
    process.env.AGENT_RUN_RETENTION_DAYS = '7'
    process.env.COMMAND_RUN_RETENTION_DAYS = '365'
    expect(envu.server.AGENT_RUN_RETENTION_DAYS).toBe(7)
    expect(envu.server.COMMAND_RUN_RETENTION_DAYS).toBe(365)
  })

  it.each(['0', '-1', '1.5', 'ninety'])('1以上の整数でなければ起動時に弾く (%s)', (value) => {
    // 0 や負数を通すと、掃除が「すべての履歴」を対象にしてしまう
    process.env.AGENT_RUN_RETENTION_DAYS = value
    process.env.COMMAND_RUN_RETENTION_DAYS = value
    expect(() => envu.server.AGENT_RUN_RETENTION_DAYS).toThrow()
    expect(() => envu.server.COMMAND_RUN_RETENTION_DAYS).toThrow()
  })

  it.each(['1e100', '100000001'])('Date の範囲を超える日数は起動時に弾く (%s)', (value) => {
    // 境界が Invalid Date になると Prisma が受け付けず、掃除が丸ごと止まる
    process.env.AGENT_RUN_RETENTION_DAYS = value
    process.env.COMMAND_RUN_RETENTION_DAYS = value
    expect(() => envu.server.AGENT_RUN_RETENTION_DAYS).toThrow()
    expect(() => envu.server.COMMAND_RUN_RETENTION_DAYS).toThrow()
  })

  it('上限ちょうどは通り、境界が Date として有効', () => {
    process.env.AGENT_RUN_RETENTION_DAYS = '100000000'
    process.env.COMMAND_RUN_RETENTION_DAYS = '100000000'
    expect(envu.server.AGENT_RUN_RETENTION_DAYS).toBe(100_000_000)
    expect(envu.server.COMMAND_RUN_RETENTION_DAYS).toBe(100_000_000)
    const before = new Date(Date.now() - envu.server.COMMAND_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    expect(Number.isNaN(before.getTime())).toBe(false)
  })
})

describe('AGENT_RUN_KEEP', () => {
  restoreEnv('AGENT_RUN_KEEP')

  it('未設定なら500件', () => {
    delete process.env.AGENT_RUN_KEEP
    expect(envu.server.AGENT_RUN_KEEP).toBe(500)
  })

  it('画面が出せる件数までは下げられる', () => {
    process.env.AGENT_RUN_KEEP = String(AGENT_RUN_HISTORY_LIMIT)
    expect(envu.server.AGENT_RUN_KEEP).toBe(AGENT_RUN_HISTORY_LIMIT)
  })

  it('画面が出せる件数を下回ると起動時に弾く', () => {
    // 下回ると「一覧に出ているのに実体が無い」履歴が生まれる
    process.env.AGENT_RUN_KEEP = String(AGENT_RUN_HISTORY_LIMIT - 1)
    expect(() => envu.server.AGENT_RUN_KEEP).toThrow()
  })

  it.each(['0', '-1', '500.5', 'many'])('整数でなければ起動時に弾く (%s)', (value) => {
    process.env.AGENT_RUN_KEEP = value
    expect(() => envu.server.AGENT_RUN_KEEP).toThrow()
  })
})

describe('COMMAND_RUN_KEEP', () => {
  restoreEnv('COMMAND_RUN_KEEP')

  it('未設定なら300件', () => {
    delete process.env.COMMAND_RUN_KEEP
    expect(envu.server.COMMAND_RUN_KEEP).toBe(300)
  })

  it('設定した件数を返す', () => {
    process.env.COMMAND_RUN_KEEP = '10'
    expect(envu.server.COMMAND_RUN_KEEP).toBe(10)
  })

  it.each(['0', '-1', '10.5', 'ten'])('1以上の整数でなければ起動時に弾く (%s)', (value) => {
    process.env.COMMAND_RUN_KEEP = value
    expect(() => envu.server.COMMAND_RUN_KEEP).toThrow()
  })
})
