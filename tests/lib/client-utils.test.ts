/** `safeCallbackPath` はオープンリダイレクトのガードなので、危険になりうる入力を重点的に確認する */

import { safeCallbackPath } from '@/lib/client-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://app.example.com'

const stubWindow = () => vi.stubGlobal('window', { location: { origin: ORIGIN } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('safeCallbackPath: 認証後の遷移先の検証', () => {
  it('自サイト内の絶対パスはそのまま通す', () => {
    stubWindow()
    expect(safeCallbackPath('/tickets')).toBe('/tickets')
    expect(safeCallbackPath('/tickets?page=2#top'), 'クエリとハッシュも保つ').toBe('/tickets?page=2#top')
  })

  it('同一オリジンの絶対URLはパスへ畳む', () => {
    stubWindow()
    expect(safeCallbackPath(`${ORIGIN}/boards/1`)).toBe('/boards/1')
  })

  it('他オリジンへの誘導は既定値へ落とす', () => {
    stubWindow()
    expect(safeCallbackPath('https://evil.example/')).toBe('/')
    expect(safeCallbackPath('//evil.example/'), 'プロトコル相対').toBe('/')
    expect(safeCallbackPath('/\\evil.example/'), 'バックスラッシュ').toBe('/')
    expect(safeCallbackPath('http://user@evil.example/'), '認証情報付き').toBe('/')
  })

  it('スキームを持つ危険な値も既定値へ落とす', () => {
    stubWindow()
    expect(safeCallbackPath('javascript:alert(1)')).toBe('/')
    expect(safeCallbackPath('data:text/html,<script>alert(1)</script>')).toBe('/')
  })

  it('未指定は既定値。既定値は呼び出し側で指定できる', () => {
    stubWindow()
    expect(safeCallbackPath(null)).toBe('/')
    expect(safeCallbackPath(undefined)).toBe('/')
    expect(safeCallbackPath('')).toBe('/')
    expect(safeCallbackPath('https://evil.example/', '/home')).toBe('/home')
  })

  it('window が無い(サーバー側での評価)場合は既定値', () => {
    expect(safeCallbackPath('/tickets')).toBe('/')
  })
})
