/**
 * アップロードキーとURLの相互変換・検証の単体テスト
 *
 * `src/lib/upload.ts` はサーバー/クライアント両方から使う純粋関数なので、
 * ストレージやDBを起動せずに検証できる。
 */

import {
  extractUploadKeys,
  formatFileSize,
  isValidUploadKey,
  newUploadKey,
  toUploadExt,
  toUploadKey,
  toUploadUrl,
  UPLOAD_URL_PREFIX,
} from '@/lib/storage/upload'
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

describe('extractUploadKeys', () => {
  const a = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'
  const b = '019eef64-6cc1-78f1-8f50-1ef86986289b.png'

  it('本文中の複数の添付URLをキーとして取り出す', () => {
    const content = `![a](${toUploadUrl(a)})\n\n本文\n\n![b](${toUploadUrl(b)})`
    expect(extractUploadKeys(content)).toEqual([a, b])
  })

  it('同じキーは1つにまとめる', () => {
    expect(extractUploadKeys(`![](${toUploadUrl(a)}) ![](${toUploadUrl(a)})`)).toEqual([a])
  })

  it('形式を満たさないキーは無視する', () => {
    const content = `![](${UPLOAD_URL_PREFIX}/../../etc/passwd) ![](${UPLOAD_URL_PREFIX}/not-a-uuid.webp) ![](${toUploadUrl(a)})`
    expect(extractUploadKeys(content)).toEqual([a])
  })

  it('URL の直後の句読点はキーに含めない', () => {
    const key = '019eef64-6cc1-78f1-8f50-1ef86986289a.log'
    expect(extractUploadKeys(`ログ: ${toUploadUrl(key)}. 以上`)).toEqual([key])
  })

  it('添付URLが無ければ空配列', () => {
    expect(extractUploadKeys('本文だけ https://example.com/image.webp')).toEqual([])
    expect(extractUploadKeys('')).toEqual([])
  })
})

describe('isValidUploadKey', () => {
  it.each([
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.webp', 'webp'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.png', 'png'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.jpg', 'jpg'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.jpeg', 'jpeg'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.gif', 'gif'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.pdf', 'ファイル添付(pdf)'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.bin', '拡張子を決められないファイル'],
  ])('許可する: %s (%s)', (key) => {
    expect(isValidUploadKey(key)).toBe(true)
  })

  it.each([
    ['', '空文字'],
    ['../../etc/passwd', 'パストラバーサル'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a/../secret.webp', 'キー内のパストラバーサル'],
    ['sub/019eef64-6cc1-78f1-8f50-1ef86986289a.webp', 'ディレクトリ区切り'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.PDF', '大文字の拡張子'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.verylongext', '11文字以上の拡張子'],
    ['019eef64-6cc1-78f1-8f50-1ef86986289a.tar-gz', '英数字以外を含む拡張子'],
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

describe('toUploadExt', () => {
  it.each([
    ['report.pdf', 'pdf'],
    ['Archive.TAR.GZ', 'gz'],
    ['build.log', 'log'],
  ])('ファイル名の拡張子を小文字で返す: %s', (name, ext) => {
    expect(toUploadExt(name)).toBe(ext)
  })

  it.each([
    ['README', '拡張子なし'],
    ['.env', 'ドットファイル'],
    ['data.verylongext', '11文字以上'],
    ['a.tar-gz', '英数字以外を含む'],
    ['memo.テキスト', '英数字以外の文字'],
    ['trailing.', '末尾がドット'],
  ])('キーに使えないものは bin にする: %s (%s)', (name) => {
    expect(toUploadExt(name)).toBe('bin')
  })

  it('返した拡張子でキーの検証を通る', () => {
    expect(isValidUploadKey(newUploadKey(toUploadExt('x.Docx')))).toBe(true)
  })
})

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [10 * 1024 * 1024, '10.0 MB'],
  ])('%d バイト → %s', (bytes, text) => {
    expect(formatFileSize(bytes)).toBe(text)
  })
})
