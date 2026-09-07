/**
 * 送信先エンドポイントの検査
 *
 * 保存したエンドポイントは送信時にサーバーの接続先になるため、内部を指す URL を
 * 通さないことを固定する(表記を変えた抜け道も含めて確認する)。
 */

import { isAllowedWebPushEndpoint } from '@/lib/webpush/webpush-endpoint'
import { describe, expect, it } from 'vitest'

describe('通すエンドポイント', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QABC',
    'https://example.notify.windows.com/w/?token=abc',
    // 公開アドレスであれば IP 直指定も通す
    'https://8.8.8.8/wpush',
  ])('%s', (endpoint) => {
    expect(isAllowedWebPushEndpoint(endpoint)).toBe(true)
  })
})

describe('通さないエンドポイント', () => {
  it.each([
    // HTTPS 以外
    'http://fcm.googleapis.com/fcm/send/abc',
    'ftp://fcm.googleapis.com/abc',
    // ホスト名で内部を指すもの
    'https://localhost/wpush',
    'https://LOCALHOST/wpush',
    'https://api.localhost/wpush',
    'https://printer.local/wpush',
    // ループバック(10 進 / 16 進 / 短縮形も URL 側で正規化される)
    'https://127.0.0.1/wpush',
    'https://2130706433/wpush',
    'https://0x7f.0.0.1/wpush',
    'https://127.1/wpush',
    // 私設 / リンクローカル / CGNAT / 未指定
    'https://10.0.0.5/wpush',
    'https://172.16.3.4/wpush',
    'https://172.31.255.255/wpush',
    'https://192.168.1.1/wpush',
    'https://169.254.169.254/latest/meta-data',
    'https://100.64.0.1/wpush',
    'https://0.0.0.0/wpush',
    // IPv6(ループバック / 未指定 / ユニークローカル / リンクローカル / IPv4 射影)
    'https://[::1]/wpush',
    'https://[::]/wpush',
    'https://[fd00::1]/wpush',
    'https://[fe80::1]/wpush',
    'https://[::ffff:127.0.0.1]/wpush',
    'https://[::ffff:10.0.0.1]/wpush',
    // 既定以外のポートと資格情報付き
    'https://example.com:8443/wpush',
    'https://user:pass@fcm.googleapis.com/fcm/send/abc',
    // URL として読めない
    'not a url',
  ])('%s', (endpoint) => {
    expect(isAllowedWebPushEndpoint(endpoint)).toBe(false)
  })
})
