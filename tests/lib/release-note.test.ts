import { splitReleaseNote } from '@/lib/release-note'
import { describe, expect, it } from 'vitest'

describe('splitReleaseNote', () => {
  it('区切りより前だけを要点にする', () => {
    const body = '- 要点1\r\n- 要点2\r\n\r\n<!-- details -->\r\n\r\n## 新機能\r\n- 詳細'
    expect(splitReleaseNote(body)).toEqual({ summary: '- 要点1\r\n- 要点2', hasDetails: true })
  })

  it('区切りが無ければ全文を要点にする', () => {
    expect(splitReleaseNote('\n- PDF出力(印刷)対応\n')).toEqual({ summary: '- PDF出力(印刷)対応', hasDetails: false })
  })

  it('本文が無ければ空', () => {
    expect(splitReleaseNote(null)).toEqual({ summary: '', hasDetails: false })
    expect(splitReleaseNote(undefined)).toEqual({ summary: '', hasDetails: false })
  })
})
