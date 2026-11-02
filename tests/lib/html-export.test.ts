/**
 * HTML 出力(`html-export.ts`)の単体テスト。DOM を使う関数は対象外
 */

import { buildHtmlDocument } from '@/lib/html-export'
import { describe, expect, it } from 'vitest'

const base = { title: 'DEV-1 件名', lang: 'ja', htmlClass: 'light', bodyClass: 'bg-background', css: '', body: '' }

describe('buildHtmlDocument: 保存する HTML 文書', () => {
  it('文字コード・タイトル・クラス・本文を持つ文書にする', () => {
    const html = buildHtmlDocument({ ...base, css: '.a{color:red}', body: '<article>本文</article>' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="ja" class="light">')
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<meta name="color-scheme" content="light">')
    expect(html).toContain('<title>DEV-1 件名</title>')
    expect(html).toContain('<style>.a{color:red}</style>')
    expect(html).toContain('<body class="bg-background">')
    expect(html).toContain('<article>本文</article>')
  })

  it('タイトルと属性はエスケープする', () => {
    const html = buildHtmlDocument({ ...base, title: '<script>&"\'', htmlClass: 'a" onload="x' })
    expect(html).toContain('<title>&lt;script&gt;&amp;&quot;&#39;</title>')
    expect(html).toContain('class="a&quot; onload=&quot;x"')
  })

  it('CSS 中の </style で要素が閉じないようにする', () => {
    const html = buildHtmlDocument({ ...base, css: '.a{content:"</style><script>"}' })
    expect(html).toContain('.a{content:"<\\/style><script>"}')
    expect(html.match(/<\/style>/g)).toHaveLength(1)
  })
})
