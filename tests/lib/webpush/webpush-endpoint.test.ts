/**
 * 送信先エンドポイントの検査
 *
 * 保存したエンドポイントは送信時にサーバーの接続先になるため、内部を指す URL を
 * 通さないことを固定する(表記を変えた抜け道も含めて確認する)。
 */

import { isAllowedWebPushEndpoint, isPrivateAddress } from '@/lib/webpush/webpush-endpoint'
import { describe, expect, it } from 'vitest'

describe('通すエンドポイント', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QABC',
    'https://example.notify.windows.com/w/?token=abc',
    // 公開アドレスであれば IP 直指定も通す
    'https://8.8.8.8/wpush',
    // 予約範囲の境界の外側
    'https://198.17.255.255/wpush',
    'https://198.20.0.1/wpush',
    'https://192.0.1.1/wpush',
    // 公開の IPv4 を埋め込んだ IPv6 は通す
    'https://[64:ff9b::808:808]/wpush',
    'https://[2002:808:808::1]/wpush',
    'https://[2606:4700::1111]/wpush',
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
    // 予約範囲(ベンチマーク用 / TEST-NET / プロトコル割り当て / マルチキャスト / ブロードキャスト)
    'https://198.18.0.1/wpush',
    'https://198.19.255.255/wpush',
    'https://192.0.0.1/wpush',
    'https://192.0.2.1/wpush',
    'https://198.51.100.1/wpush',
    'https://203.0.113.1/wpush',
    'https://224.0.0.1/wpush',
    'https://255.255.255.255/wpush',
    // IPv6(ループバック / 未指定 / ユニークローカル / リンクローカル / IPv4 射影)
    'https://[::1]/wpush',
    'https://[::]/wpush',
    'https://[fd00::1]/wpush',
    'https://[fe80::1]/wpush',
    'https://[::ffff:127.0.0.1]/wpush',
    'https://[::ffff:10.0.0.1]/wpush',
    'https://[::ffff:198.18.0.1]/wpush',
    // IPv4 互換 / NAT64 / 6to4 は埋め込まれた IPv4 で判定する
    'https://[::127.0.0.1]/wpush',
    'https://[64:ff9b::7f00:1]/wpush',
    'https://[64:ff9b::10.0.0.1]/wpush',
    'https://[64:ff9b:1::1]/wpush',
    'https://[2002:7f00:1::1]/wpush',
    'https://[2002:c0a8:101::]/wpush',
    // マルチキャスト / サイトローカル / 文書用
    'https://[ff02::1]/wpush',
    'https://[fec0::1]/wpush',
    'https://[2001:db8::1]/wpush',
    // 既定以外のポートと資格情報付き
    'https://example.com:8443/wpush',
    'https://user:pass@fcm.googleapis.com/fcm/send/abc',
    // URL として読めない
    'not a url',
  ])('%s', (endpoint) => {
    expect(isAllowedWebPushEndpoint(endpoint)).toBe(false)
  })
})

describe('isPrivateAddress: 名前解決の結果の判定', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    'fe80::1%eth0',
    'FD00::1',
  ])('%s は内部', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('%s は通す', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })
})
