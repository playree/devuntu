/**
 * robots.txt の生成の単体テスト
 *
 * 設定を書き忘れた環境が検索結果へ載らないことを確認する。
 */

import robots from '@/app/robots'
import { afterEach, describe, expect, it } from 'vitest'

const original = {
  indexing: process.env.SEARCH_ENGINE_INDEXING,
  robotsAllow: process.env.SEARCH_ENGINE_ROBOTS_ALLOW,
}

const restore = (key: 'SEARCH_ENGINE_INDEXING' | 'SEARCH_ENGINE_ROBOTS_ALLOW', value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

const allowedRules = {
  userAgent: '*',
  allow: '/',
  disallow: ['/api/', '/cal/'],
}

afterEach(() => {
  restore('SEARCH_ENGINE_INDEXING', original.indexing)
  restore('SEARCH_ENGINE_ROBOTS_ALLOW', original.robotsAllow)
})

describe('robots', () => {
  it('未設定なら全パスを拒否する', () => {
    delete process.env.SEARCH_ENGINE_INDEXING
    delete process.env.SEARCH_ENGINE_ROBOTS_ALLOW
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' })
  })

  it('どちらも false なら全パスを拒否する', () => {
    process.env.SEARCH_ENGINE_INDEXING = 'false'
    process.env.SEARCH_ENGINE_ROBOTS_ALLOW = 'false'
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' })
  })

  it('SEARCH_ENGINE_ROBOTS_ALLOW だけ true ならクロールを許可する', () => {
    // noindex を読ませるため、インデックス拒否のままクロールだけ通す
    process.env.SEARCH_ENGINE_INDEXING = 'false'
    process.env.SEARCH_ENGINE_ROBOTS_ALLOW = 'true'
    expect(robots().rules).toEqual(allowedRules)
  })

  it('SEARCH_ENGINE_INDEXING が true ならクロール許可の指定が無くても許可する', () => {
    process.env.SEARCH_ENGINE_INDEXING = 'true'
    delete process.env.SEARCH_ENGINE_ROBOTS_ALLOW
    expect(robots().rules).toEqual(allowedRules)
  })

  it('両方 true でも許可は重ならない', () => {
    process.env.SEARCH_ENGINE_INDEXING = 'true'
    process.env.SEARCH_ENGINE_ROBOTS_ALLOW = 'true'
    expect(robots().rules).toEqual(allowedRules)
  })
})
