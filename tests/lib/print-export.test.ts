/**
 * 印刷用ページの共通部分(`print-export.ts`)の単体テスト
 */

import { exportFileName, parsePrintFormat, setPrintFormatParam, withQuery } from '@/lib/print-export'
import { describe, expect, it } from 'vitest'

describe('parsePrintFormat: 出力形式', () => {
  it('pdf / html はそのまま', () => {
    expect(parsePrintFormat('pdf')).toBe('pdf')
    expect(parsePrintFormat('html')).toBe('html')
  })

  it('未指定・不正値・配列は pdf', () => {
    expect(parsePrintFormat(undefined)).toBe('pdf')
    expect(parsePrintFormat('docx')).toBe('pdf')
    expect(parsePrintFormat(['html'])).toBe('pdf')
  })
})

describe('setPrintFormatParam / withQuery: クエリの組み立て', () => {
  it('pdf は付けず、クエリが空ならパスだけ', () => {
    const query = new URLSearchParams()
    setPrintFormatParam(query, 'pdf')
    expect(withQuery('/print/x', query)).toBe('/print/x')
  })

  it('html は format を付ける', () => {
    const query = new URLSearchParams()
    setPrintFormatParam(query, 'html')
    expect(withQuery('/print/x', query)).toBe('/print/x?format=html')
  })
})

describe('exportFileName: 保存ファイル名', () => {
  it('拡張子を付け、使えない文字は _ にする', () => {
    expect(exportFileName('DOCS-1 a/b:c', 'md', 'wiki')).toBe('DOCS-1 a_b_c.md')
  })

  it('空になる場合は fallback', () => {
    expect(exportFileName('  ', 'html', 'wiki')).toBe('wiki.html')
  })
})
