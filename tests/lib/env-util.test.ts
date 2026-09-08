/**
 * 環境変数の読み取りの単体テスト
 *
 * 値の綴り違いが不可逆な操作へ落ちないことを確認する。
 */

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
