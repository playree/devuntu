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
})
