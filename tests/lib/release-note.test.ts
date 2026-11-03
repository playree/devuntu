import { splitReleaseNote } from '@/lib/release-note'
import { describe, expect, it } from 'vitest'

describe('splitReleaseNote', () => {
  it('区切りより前だけを要点にする', () => {
    const body = '- 要点1\r\n- 要点2\r\n\r\n<!-- details -->\r\n\r\n## 新機能\r\n- 詳細'
    expect(splitReleaseNote(body)).toEqual({ summary: '- 要点1\r\n- 要点2', localized: {}, hasDetails: true })
  })

  it('区切りが無ければ全文を要点にする', () => {
    expect(splitReleaseNote('\n- PDF出力(印刷)対応\n')).toEqual({
      summary: '- PDF出力(印刷)対応',
      localized: {},
      hasDetails: false,
    })
  })

  it('本文が無ければ空', () => {
    expect(splitReleaseNote(null)).toEqual({ summary: '', localized: {}, hasDetails: false })
    expect(splitReleaseNote(undefined)).toEqual({ summary: '', localized: {}, hasDetails: false })
  })

  it('言語の区切りで要点をロケールごとに分ける', () => {
    const body = '- 要点\r\n\r\n<!-- lang:en -->\r\n\r\n- Summary\r\n\r\n<!-- details -->\r\n\r\n## 新機能\r\n- 詳細'
    expect(splitReleaseNote(body)).toEqual({ summary: '- 要点', localized: { en: '- Summary' }, hasDetails: true })
  })

  it('複数の言語に分ける', () => {
    const body = '- 要点\n<!-- lang:en -->\n- Summary\n<!-- lang:zh-TW -->\n- 摘要\n'
    expect(splitReleaseNote(body)).toEqual({
      summary: '- 要点',
      localized: { en: '- Summary', 'zh-TW': '- 摘要' },
      hasDetails: false,
    })
  })

  it('詳細にある言語の区切りは要点に含めない', () => {
    const body = '- 要点\n<!-- details -->\n## 新機能\n<!-- lang:en -->\n- Details'
    expect(splitReleaseNote(body)).toEqual({ summary: '- 要点', localized: {}, hasDetails: true })
  })
})
