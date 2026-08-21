/**
 * 動的クライアント登録で受け付けるリダイレクトURIの単体テスト
 *
 * `POST /oauth2/register` は未認証で叩けるため、認可コードの戻り先をローカルに閉じておく
 * この判定が、外部へコードを流すクライアントを登録させないための門番になる。
 */

import { isLocalRedirectUri, isLocalRegistration } from '@/lib/oauth/oauth-registration'
import { describe, expect, it } from 'vitest'

describe('isLocalRedirectUri', () => {
  it.each(['http://localhost:8080/callback', 'http://127.0.0.1:0/cb', 'http://[::1]:1/cb', 'http://localhost/cb'])(
    'ループバックの http を受け入れる: %s',
    (uri) => {
      expect(isLocalRedirectUri(uri)).toBe(true)
    },
  )

  it('逆ドメイン形式の private-use スキームを受け入れる', () => {
    expect(isLocalRedirectUri('com.example.app:/oauth')).toBe(true)
  })

  it.each([
    'https://evil.example/cb',
    'http://evil.example/cb',
    // ループバックに見せかけたホスト名を通さない
    'http://localhost.evil.example/cb',
    'http://localhost./cb',
    // https はループバックでも native クライアントとしては認められない
    'https://localhost:8080/cb',
  ])('外部に戻る URI を拒否する: %s', (uri) => {
    expect(isLocalRedirectUri(uri)).toBe(false)
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/cb', 'mailto:a@example.com'])(
    '危険なスキームを拒否する: %s',
    (uri) => {
      expect(isLocalRedirectUri(uri)).toBe(false)
    },
  )

  it('ドットを含まないスキームは private-use とみなさない', () => {
    expect(isLocalRedirectUri('myapp:/oauth')).toBe(false)
  })

  it('URL としてパースできない文字列を拒否する', () => {
    expect(isLocalRedirectUri('not a url')).toBe(false)
  })
})

describe('isLocalRegistration', () => {
  it('すべてローカルなら受け入れる', () => {
    expect(isLocalRegistration(['http://localhost:1/cb', 'com.example.app:/oauth'])).toBe(true)
  })

  it('1つでも外部に戻るものが混ざれば拒否する', () => {
    expect(isLocalRegistration(['http://localhost:1/cb', 'https://evil.example/cb'])).toBe(false)
  })

  it('空配列と未指定を拒否する', () => {
    expect(isLocalRegistration([])).toBe(false)
    expect(isLocalRegistration(undefined)).toBe(false)
  })
})
