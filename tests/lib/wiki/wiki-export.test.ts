/**
 * Wiki ページの出力(`wiki/wiki-export.ts`)の単体テスト
 */

import {
  absolutizeUploadUrls,
  wikiExportFileName,
  wikiExportTitle,
  wikiMarkdownExport,
  wikiPrintPath,
} from '@/lib/wiki/wiki-export'
import { describe, expect, it } from 'vitest'

const ORIGIN = 'https://devuntu.example'

describe('wikiPrintPath: 印刷用ページのパス', () => {
  it('版・形式の指定なしはパスだけ', () => {
    expect(wikiPrintPath({ key: 'DOCS', number: 3 })).toBe('/print/wiki/DOCS/3')
  })

  it('版はクエリに付ける', () => {
    expect(wikiPrintPath({ key: 'DOCS', number: 3 }, { revisionId: 'r1' })).toBe('/print/wiki/DOCS/3?rev=r1')
  })

  it('html は format を付ける', () => {
    expect(wikiPrintPath({ key: 'DOCS', number: 3 }, { format: 'html' })).toBe('/print/wiki/DOCS/3?format=html')
    expect(wikiPrintPath({ key: 'DOCS', number: 3 }, { revisionId: 'r1', format: 'html' })).toBe(
      '/print/wiki/DOCS/3?rev=r1&format=html',
    )
  })
})

describe('wikiExportTitle / wikiExportFileName: 文書タイトルとファイル名', () => {
  it('KEY-番号 タイトル', () => {
    expect(wikiExportTitle({ key: 'DOCS', number: 3, title: '設計' })).toBe('DOCS-3 設計')
  })

  it('過去の版は版数を付ける', () => {
    expect(wikiExportTitle({ key: 'DOCS', number: 3, title: '設計', revisionNumber: 2 })).toBe('DOCS-3 設計 (v2)')
  })

  it('ファイル名は使えない文字を _ にして拡張子を付ける', () => {
    expect(wikiExportFileName('DOCS-3 a/b', 'md')).toBe('DOCS-3 a_b.md')
    expect(wikiExportFileName('DOCS-3 a/b', 'html')).toBe('DOCS-3 a_b.html')
  })
})

describe('absolutizeUploadUrls: アップロードの URL の絶対化', () => {
  it('Markdown の画像とリンク', () => {
    expect(absolutizeUploadUrls('![図](/api/upload/a.webp) [資料](/api/upload/b.pdf)', ORIGIN)).toBe(
      `![図](${ORIGIN}/api/upload/a.webp) [資料](${ORIGIN}/api/upload/b.pdf)`,
    )
  })

  it('HTML の属性・山括弧・参照形式の定義', () => {
    expect(absolutizeUploadUrls('<img src="/api/upload/a.webp"> <img src=\'/api/upload/b.png\'>', ORIGIN)).toBe(
      `<img src="${ORIGIN}/api/upload/a.webp"> <img src='${ORIGIN}/api/upload/b.png'>`,
    )
    expect(absolutizeUploadUrls('![図](</api/upload/a.webp>)', ORIGIN)).toBe(`![図](<${ORIGIN}/api/upload/a.webp>)`)
    expect(absolutizeUploadUrls('[1]: /api/upload/a.webp\n/api/upload/b.webp', ORIGIN)).toBe(
      `[1]: ${ORIGIN}/api/upload/a.webp\n${ORIGIN}/api/upload/b.webp`,
    )
  })

  it('絶対 URL・別のパスは変えない', () => {
    const markdown = '![外部](https://example.com/api/upload/a.webp) [x](/wiki/DOCS/1) foo/api/upload/a'
    expect(absolutizeUploadUrls(markdown, ORIGIN)).toBe(markdown)
  })
})

describe('wikiMarkdownExport: Markdown 出力の内容', () => {
  it('通常のページはタイトルの見出しを付け、画像を絶対 URL にする', () => {
    expect(
      wikiMarkdownExport({ title: '手順', type: 'page', content: '![図](/api/upload/a.webp)', origin: ORIGIN }),
    ).toBe(`# 手順\n\n![図](${ORIGIN}/api/upload/a.webp)`)
  })

  it('本文が空なら見出しだけ', () => {
    expect(wikiMarkdownExport({ title: '手順', type: 'page', content: '  ', origin: ORIGIN })).toBe('# 手順\n')
  })

  it('設計書は front matter を先頭に残すため本文のまま', () => {
    const content = '---\ntype: design_doc\ntitle: 設計\n---\n\n![図](/api/upload/a.webp)'
    expect(wikiMarkdownExport({ title: '設計', type: 'design_doc', content, origin: ORIGIN })).toBe(
      `---\ntype: design_doc\ntitle: 設計\n---\n\n![図](${ORIGIN}/api/upload/a.webp)`,
    )
  })
})
