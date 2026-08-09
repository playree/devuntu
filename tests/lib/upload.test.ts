/**
 * アップロードキーとURLの相互変換・検証の単体テスト
 *
 * `src/lib/upload.ts` はサーバー/クライアント両方から使う純粋関数なので、
 * ストレージやDBを起動せずに検証できる。
 */

import { isValidUploadKey, newUploadKey, toUploadKey, toUploadUrl, UPLOAD_URL_PREFIX } from '@/lib/upload'
import { describe, expect, it } from 'vitest'

describe('toUploadUrl / toUploadKey', () => {
  it('キーとURLを相互変換できる', () => {
    const key = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'
    const url = toUploadUrl(key)
    expect(url).toBe(`${UPLOAD_URL_PREFIX}/${key}`)
    expect(toUploadKey(url)).toBe(key)
  })
})

describe('newUploadKey', () => {
  it('拡張子付きの検証を通るキーを生成する', () => {
    const key = newUploadKey('webp')
    expect(key.endsWith('.webp')).toBe(true)
    expect(isValidUploadKey(key)).toBe(true)
  })

  it('呼び出しごとに異なるキーになる', () => {
    expect(newUploadKey('webp')).not.toBe(newUploadKey('webp'))
  })
})

describe('isValidUploadKey', () => {
  it.each([
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.webp', 'webp'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.png', 'png'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.jpg', 'jpg'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.jpeg', 'jpeg'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.gif', 'gif'],
  ])('許可する: %s (%s)', (key) => {
    expect(isValidUploadKey(key)).toBe(true)
  })

  it.each([
    ['', '空文字'],
    ['../../etc/passwd', 'パストラバーサル'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a/../secret.webp', 'キー内のパストラバーサル'],
    ['sub/019eef64-6cc1-78f1-8f50-1ef86986289a.webp', 'ディレクトリ区切り'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.svg', '許可しない拡張子(svg)'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a', '拡張子なし'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.webp.svg', '二重拡張子'],
    ['not-a-uuid.webp', 'UUID形式でない'],
    ['f47ac10b-58cc-4372-a567-0e02b2c3d479.webp', 'UUIDv4(版数が7でない)'],
    ['019eef64-6cc1-78f1-cf50-1ef86986289a.webp', 'variantが不正'],
    ['019f042a-eb50-755d-b7e0-05094ab48731-mquzdfmo.webp', 'UUIDの後ろにサフィックスが付く'],
    ['019EEF64-6CC1-78F1-8F50-1EF86986289A.webp', '大文字(生成されない形式)'],
  ])('拒否する: %s (%s)', (key) => {
    expect(isValidUploadKey(key)).toBe(false)
  })
})
