/**
 * robots.txt の生成の単体テスト
 *
 * 設定を書き忘れた環境が検索結果へ載らないことを確認する。
 */

import robots from '@/app/robots'
import { afterEach, describe, expect, it } from 'vitest'

const original = process.env.SEARCH_ENGINE_INDEXING

afterEach(() => {
  if (original === undefined) {
    delete process.env.SEARCH_ENGINE_INDEXING
  } else {
    process.env.SEARCH_ENGINE_INDEXING = original
  }
})

describe('robots', () => {
  it('未設定なら全パスを拒否する', () => {
    delete process.env.SEARCH_ENGINE_INDEXING
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' })
  })

  it('false なら全パスを拒否する', () => {
    process.env.SEARCH_ENGINE_INDEXING = 'false'
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' })
  })

  it('true なら許可し、API と共有カレンダーだけ除外する', () => {
    process.env.SEARCH_ENGINE_INDEXING = 'true'
    expect(robots().rules).toEqual({
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/cal/'],
    })
  })
})
