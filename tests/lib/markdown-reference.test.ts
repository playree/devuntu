/**
 * 参照リンク / 参照画像と定義の対応付けの単体テスト
 *
 * import visitor 自体は Lexical と DOM を要し vitest(environment: node)からは動かせないため、
 * 取り込みの前に木全体から定義を引く部分を固定する。
 */

import { MdastLike, resolveMarkdownReferences } from '@/lib/markdown-reference'
import { describe, expect, it } from 'vitest'

const paragraph = (...children: MdastLike[]): MdastLike => ({ type: 'paragraph', children })
const definition = (identifier: string, url: string, title: string | null = null): MdastLike => ({
  type: 'definition',
  identifier,
  url,
  title,
})
const linkReference = (identifier: string): MdastLike => ({
  type: 'linkReference',
  identifier,
  children: [{ type: 'text' }],
})

describe('resolveMarkdownReferences', () => {
  it('参照より後ろに書いた定義も引ける', () => {
    const reference = linkReference('x')
    const root = { type: 'root', children: [paragraph(reference), definition('x', 'https://example.com', 'T')] }

    expect(resolveMarkdownReferences<MdastLike>(root).get(reference)).toEqual({
      url: 'https://example.com',
      title: 'T',
    })
  })

  it('引用やリストの中の参照・定義も対象にする', () => {
    const reference = linkReference('x')
    const imageReference: MdastLike = { type: 'imageReference', identifier: 'img' }
    const root = {
      type: 'root',
      children: [
        { type: 'list', children: [{ type: 'listItem', children: [paragraph(reference, imageReference)] }] },
        { type: 'blockquote', children: [definition('x', '/a'), definition('img', '/b.png')] },
      ],
    }

    const resolved = resolveMarkdownReferences<MdastLike>(root)
    expect(resolved.get(reference)).toEqual({ url: '/a', title: null })
    expect(resolved.get(imageReference)).toEqual({ url: '/b.png', title: null })
  })

  it('同じ識別子の定義が複数あれば最初のものを使う', () => {
    const reference = linkReference('x')
    const root = {
      type: 'root',
      children: [definition('x', '/first'), paragraph(reference), definition('x', '/second')],
    }

    expect(resolveMarkdownReferences<MdastLike>(root).get(reference)?.url).toBe('/first')
  })

  it('定義の無い参照は結果に含めない', () => {
    const root = { type: 'root', children: [paragraph(linkReference('x')), definition('y', '/y')] }

    expect(resolveMarkdownReferences<MdastLike>(root).size).toBe(0)
  })
})
