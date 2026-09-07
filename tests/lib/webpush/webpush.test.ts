/**
 * Web プッシュの共通定義の単体テスト
 *
 * 送信(`webpush-server.ts`)は外部サービスに依存するので、結果の分類だけを別で見る。
 */

import {
  guessDeviceLabel,
  isSameApplicationServerKey,
  MAX_WEBPUSH_LABEL,
  urlBase64ToUint8Array,
} from '@/lib/webpush/webpush'
import { describe, expect, it } from 'vitest'

describe('urlBase64ToUint8Array: VAPID 公開鍵の変換', () => {
  it('base64url をバイト列へ戻す', () => {
    // "Hello" を base64url にしたもの
    expect([...urlBase64ToUint8Array('SGVsbG8')]).toEqual([72, 101, 108, 108, 111])
  })

  it('パディングが省略されていても復元できる(base64url は `=` を落とす)', () => {
    expect([...urlBase64ToUint8Array('QQ')]).toEqual([65])
    expect([...urlBase64ToUint8Array('QUI')]).toEqual([65, 66])
    expect([...urlBase64ToUint8Array('QUJD')]).toEqual([65, 66, 67])
  })

  it('base64url 固有の `-` `_` を標準 base64 の `+` `/` として扱う', () => {
    // 0xFB 0xFF は標準 base64 で "+/8=" になる
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255])
  })

  it('VAPID 公開鍵は非圧縮点の 65 バイトになる', () => {
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkTVHVBtE3P4qCJIMLPvJqCcCmZbTMtjBCJ8jXBoJcCPMYCJvQVfEcM'
    expect(urlBase64ToUint8Array(key).length).toBe(65)
  })

  it('BufferSource として渡せる ArrayBuffer 裏付けになる', () => {
    // SharedArrayBuffer 裏付けだと pushManager.subscribe() へ渡せない
    expect(urlBase64ToUint8Array('SGVsbG8').buffer).toBeInstanceOf(ArrayBuffer)
  })
})

describe('isSameApplicationServerKey: 既存購読の鍵の一致', () => {
  const key = urlBase64ToUint8Array('SGVsbG8')

  it('同じ鍵なら購読をそのまま使える', () => {
    expect(isSameApplicationServerKey(urlBase64ToUint8Array('SGVsbG8').buffer, key)).toBe(true)
  })

  it('鍵を差し替えた後の購読は不一致になる(解除してから購読し直す必要がある)', () => {
    expect(isSameApplicationServerKey(urlBase64ToUint8Array('V29ybGQ').buffer, key)).toBe(false)
  })

  it('長さが違えば不一致(前方が一致していても使い回せない)', () => {
    expect(isSameApplicationServerKey(urlBase64ToUint8Array('SGVsbA').buffer, key)).toBe(false)
  })

  it('鍵を持たない購読(gcm_sender_id 由来など)は不一致として扱う', () => {
    expect(isSameApplicationServerKey(null, key)).toBe(false)
  })
})

describe('guessDeviceLabel: 端末名の推測', () => {
  it('OS とブラウザを並べる', () => {
    expect(
      guessDeviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ),
    ).toBe('Mac / Chrome')
  })

  it('Edge は Chrome の UA を含むので Edge として判定する', () => {
    expect(
      guessDeviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      ),
    ).toBe('Windows / Edge')
  })

  it('iPhone の Safari を判定する', () => {
    expect(
      guessDeviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iPhone / Safari')
  })

  it('判別できなければ空にする(画面側のフォールバックに任せる)', () => {
    expect(guessDeviceLabel('curl/8.5.0')).toBe('')
  })

  it('上限を超えない', () => {
    expect(guessDeviceLabel('Android'.repeat(50)).length).toBeLessThanOrEqual(MAX_WEBPUSH_LABEL)
  })
})
