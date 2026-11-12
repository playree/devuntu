/**
 * Wiki ページ本文の節の抽出と部分更新、front matter の判定(wiki-markdown.ts)
 */

import { VALIDATION_ERROR } from '@/lib/error'
import {
  applyTextEdits,
  designDocFrontMatter,
  extractMarkdownSection,
  hasDesignDocFrontMatter,
  hasFrontMatter,
  listMarkdownHeadings,
} from '@/lib/wiki/wiki-markdown'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const errorTypeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return { type: (e as { errorType?: string }).errorType, message: (e as Error).message }
  }
  throw new Error('not thrown')
}

const DOC = [
  '# 概要',
  '前書き',
  '',
  '## 設計',
  '設計の本文',
  '### API',
  'API の本文',
  '```sh',
  '# コメントは見出しではない',
  '```',
  '## 運用 ##',
  '運用の本文',
  '',
].join('\n')

describe('listMarkdownHeadings', () => {
  it('ATX 見出しを出現順に返し、コードブロック内の # は見出しにしない', () => {
    expect(listMarkdownHeadings(DOC).map(({ level, text }) => `${level}:${text}`)).toEqual([
      '1:概要',
      '2:設計',
      '3:API',
      '2:運用',
    ])
  })

  it('# の後に空白が無いものは見出しにしない', () => {
    expect(listMarkdownHeadings('#hashtag\n####### 7個\n## OK')).toEqual([{ level: 2, text: 'OK', line: 2 }])
  })

  it('~~~ のフェンスは同じ記号で閉じるまで続く', () => {
    expect(listMarkdownHeadings('~~~\n```\n# 中\n~~~\n# 外')).toEqual([{ level: 1, text: '外', line: 4 }])
  })
})

describe('extractMarkdownSection', () => {
  it('見出しから、同じか浅い次の見出しの手前までを子見出しごと返す', () => {
    expect(extractMarkdownSection(DOC, '設計')).toBe(
      ['## 設計', '設計の本文', '### API', 'API の本文', '```sh', '# コメントは見出しではない', '```'].join('\n'),
    )
  })

  it('最後の節は末尾まで返し、末尾の空行は落とす', () => {
    expect(extractMarkdownSection(DOC, '運用')).toBe('## 運用 ##\n運用の本文')
  })

  it('先頭の # や前後の空白、大文字小文字の違いは無視して探す', () => {
    expect(extractMarkdownSection('## Setup Guide\nbody', '  ## setup guide ')).toBe('## Setup Guide\nbody')
  })

  it('見つからなければ null', () => {
    expect(extractMarkdownSection(DOC, 'コメントは見出しではない')).toBeNull()
  })
})

describe('applyTextEdits', () => {
  it('順に当て、後の edit は前の edit の結果に対して探す', () => {
    expect(
      applyTextEdits('a-b-c', [
        { oldText: 'b', newText: 'B' },
        { oldText: 'a-B', newText: 'x' },
      ]),
    ).toBe('x-c')
  })

  it('newText が空なら削除になる', () => {
    expect(applyTextEdits('keep drop keep2', [{ oldText: ' drop', newText: '' }])).toBe('keep keep2')
  })

  it('見つからない oldText は何番目の edit かを添えたエラー', () => {
    const error = errorTypeOf(() =>
      applyTextEdits('abc', [
        { oldText: 'a', newText: 'A' },
        { oldText: 'z', newText: 'Z' },
      ]),
    )
    expect(error.type).toBe(VALIDATION_ERROR)
    expect(error.message).toContain('edits[1].oldText was not found')
  })

  it('複数箇所に一致する oldText は件数を添えたエラー', () => {
    const error = errorTypeOf(() => applyTextEdits('aa-aa', [{ oldText: 'aa', newText: 'b' }]))
    expect(error.type).toBe(VALIDATION_ERROR)
    expect(error.message).toContain('matches 2 places')
  })

  it('空の oldText はエラー', () => {
    expect(errorTypeOf(() => applyTextEdits('abc', [{ oldText: '', newText: 'x' }])).type).toBe(VALIDATION_ERROR)
  })
})

describe('境界のケース', () => {
  it('CRLF の本文でも見出しを拾う', () => {
    expect(extractMarkdownSection('## Setup\r\nbody\r\n## Next\r\n', 'setup')).toBe('## Setup\r\nbody')
  })

  it('info string を持つ行はフェンスを閉じない', () => {
    expect(listMarkdownHeadings('````\n```js\n# 中\n````\n# 外').map(({ text }) => text)).toEqual(['外'])
  })

  it('閉じの # 列は空白で区切られたときだけ取り除く', () => {
    expect(listMarkdownHeadings('# a #\n# b#\n# c ##  \n# #\n# C#  #').map(({ text }) => text)).toEqual([
      'a',
      'b#',
      'c',
      '',
      'C#',
    ])
  })

  it('空白の長い見出し行でも時間がかからない', () => {
    const line = '# a' + ' '.repeat(99_990) + 'b'
    const started = Date.now()
    expect(listMarkdownHeadings(line)[0].text).toBe('a' + ' '.repeat(99_990) + 'b')
    expect(Date.now() - started).toBeLessThan(500)
  })

  it.each(['\u2028', '\u2029', '\r'])('行の途中に %j があっても時間がかからない', (c) => {
    const started = Date.now()
    expect(listMarkdownHeadings('#' + ' '.repeat(99_990) + c + 'x')).toHaveLength(1)
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('重なって現れる oldText も複数として数える', () => {
    expect(() => applyTextEdits('aaa', [{ oldText: 'aa', newText: 'b' }])).toThrow('matches 2 places')
  })
})

describe('hasDesignDocFrontMatter', () => {
  const fm = (...lines: string[]) => ['---', ...lines, '---', '', '# 本文'].join('\n')

  it('先頭の front matter の type: design_doc を設計書とみなす(キーと値の引用符・行末コメントは問わない)', () => {
    expect(hasDesignDocFrontMatter(fm('type: design_doc', 'title: ログイン'))).toBe(true)
    expect(hasDesignDocFrontMatter(fm('title: ログイン', 'type: "design_doc"'))).toBe(true)
    expect(hasDesignDocFrontMatter(fm("type: 'design_doc'"))).toBe(true)
    expect(hasDesignDocFrontMatter(fm('type:  design_doc # 設計書'))).toBe(true)
    expect(hasDesignDocFrontMatter(fm('"type": design_doc'))).toBe(true)
    expect(hasDesignDocFrontMatter(fm("'type' : design_doc"))).toBe(true)
  })

  it('BOM と CRLF の本文でも判定する', () => {
    expect(hasDesignDocFrontMatter(`\uFEFF${fm('type: design_doc')}`)).toBe(true)
    expect(hasDesignDocFrontMatter(fm('type: design_doc').replaceAll('\n', '\r\n'))).toBe(true)
  })

  it('front matter が無い・閉じていない・先頭に無いときは設計書にしない', () => {
    expect(hasDesignDocFrontMatter('# 本文\ntype: design_doc')).toBe(false)
    expect(hasDesignDocFrontMatter('---\ntype: design_doc\n')).toBe(false)
    expect(hasDesignDocFrontMatter(`\n${fm('type: design_doc')}`)).toBe(false)
    // 本文中の区切り線に挟まれた行は front matter ではない
    expect(hasDesignDocFrontMatter('# 見出し\n\n---\ntype: design_doc\n---\n')).toBe(false)
  })

  it('別の値・入れ子のキーは設計書にしない', () => {
    expect(hasDesignDocFrontMatter(fm('type: design_doc_x'))).toBe(false)
    expect(hasDesignDocFrontMatter(fm('type: "design_doc'))).toBe(false)
    expect(hasDesignDocFrontMatter(fm('meta:', '  type: design_doc'))).toBe(false)
    expect(hasDesignDocFrontMatter(fm('doctype: design_doc'))).toBe(false)
    expect(hasDesignDocFrontMatter(fm('"type\': design_doc'))).toBe(false)
    // コロンの後に空白が無ければキーではない(ビューアも設計書にしない)
    expect(hasDesignDocFrontMatter(fm('type:design_doc'))).toBe(false)
  })

  it('YAML の終端 ... でも閉じる', () => {
    expect(hasDesignDocFrontMatter('---\ntype: design_doc\n...\n本文')).toBe(true)
  })
})

describe('designDocFrontMatter', () => {
  it('設計書として判定される front matter を作り、タイトルはダブルクオートの文字列にする', () => {
    const title = "API: 'ログイン' # 設計"
    const header = designDocFrontMatter(`  ${title}  `)
    expect(header).toBe(`---\ntype: design_doc\ntitle: "${title}"\n---\n\n`)
    expect(hasDesignDocFrontMatter(`${header}# 本文`)).toBe(true)
    expect(parse(header.split('---\n')[1])).toEqual({ type: 'design_doc', title })
  })

  it('エスケープが要るタイトルはブロックスカラーにする(ビューアはエスケープを戻さない)', () => {
    for (const title of ['API "認証"', 'C:\\path', '"引用"で始まる']) {
      const header = designDocFrontMatter(title)
      expect(header).toBe(`---\ntype: design_doc\ntitle: |-\n  ${title}\n---\n\n`)
      expect(parse(header.split('---\n')[1])).toEqual({ type: 'design_doc', title })
    }
  })

  it('hasFrontMatter は閉じた front matter の有無だけを見る', () => {
    expect(hasFrontMatter('---\ntitle: a\n---\n')).toBe(true)
    expect(hasFrontMatter('# a\n---\n')).toBe(false)
  })
})
