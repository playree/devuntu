import { pickReleaseNoteSummary, splitReleaseNote } from '@/lib/release-note'
import { describe, expect, it } from 'vitest'

describe('splitReleaseNote', () => {
  it('区切りより前だけを要点にする', () => {
    const body = '- 要点1\r\n- 要点2\r\n\r\n<!-- details -->\r\n\r\n## 新機能\r\n- 詳細'
    expect(splitReleaseNote(body)).toEqual({ summary: '- 要点1\r\n- 要点2', summaryEn: '', hasDetails: true })
  })

  it('区切りが無ければ全文を要点にする', () => {
    expect(splitReleaseNote('\n- PDF出力(印刷)対応\n')).toEqual({
      summary: '- PDF出力(印刷)対応',
      summaryEn: '',
      hasDetails: false,
    })
  })

  it('本文が無ければ空', () => {
    expect(splitReleaseNote(null)).toEqual({ summary: '', summaryEn: '', hasDetails: false })
    expect(splitReleaseNote(undefined)).toEqual({ summary: '', summaryEn: '', hasDetails: false })
  })

  it('英語の区切りで要点を日本語と英語に分ける', () => {
    const body = '- 要点\r\n\r\n<!-- lang:en -->\r\n\r\n- Summary\r\n\r\n<!-- details -->\r\n\r\n## 新機能\r\n- 詳細'
    expect(splitReleaseNote(body)).toEqual({ summary: '- 要点', summaryEn: '- Summary', hasDetails: true })
  })

  it('英語の区切りの空白の有無を問わない', () => {
    expect(splitReleaseNote('- 要点\n<!--lang:en-->\n- Summary')).toEqual({
      summary: '- 要点',
      summaryEn: '- Summary',
      hasDetails: false,
    })
  })

  it('詳細にある英語の区切りは要点に含めない', () => {
    const body = '- 要点\n<!-- details -->\n## 新機能\n<!-- lang:en -->\n- Details'
    expect(splitReleaseNote(body)).toEqual({ summary: '- 要点', summaryEn: '', hasDetails: true })
  })
})

describe('pickReleaseNoteSummary', () => {
  const note = { summary: '- 要点', summaryEn: '- Summary' }

  it('日本語なら日本語', () => {
    expect(pickReleaseNoteSummary(note, 'ja')).toBe('- 要点')
  })

  it('日本語以外は英語', () => {
    expect(pickReleaseNoteSummary(note, 'en')).toBe('- Summary')
    expect(pickReleaseNoteSummary(note, 'fr')).toBe('- Summary')
  })

  it('英語が無ければ日本語', () => {
    expect(pickReleaseNoteSummary({ summary: '- 要点', summaryEn: '' }, 'en')).toBe('- 要点')
  })
})
