/**
 * Markdown 表示の生HTML無害化(`rehype-sanitize`)の許可リストの単体テスト
 *
 * アップロード画像は `/api/upload/<key>` の相対URLで本文に埋め込まれるため、
 * 許可リストがこれを除去してしまうと画像が表示されなくなる。
 * 逆に `javascript:` / `data:` は通してはいけない。この2点を固定する。
 *
 * `react-markdown` を経由せず sanitize の transformer を直接呼ぶことで、
 * DOM を用意せずに検証できる(vitest の environment は node)。
 */

import { SANITIZE_SCHEMA } from '@/components/ticket/markdown-view'
import type { Root } from 'hast'
import rehypeSanitize from 'rehype-sanitize'
import { describe, expect, it } from 'vitest'

/** `img` を1つだけ持つ hast ツリーを許可リストに通し、残った src を返す */
const sanitizeImgSrc = (src: string) => {
  const tree: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [{ type: 'element', tagName: 'img', properties: { src, alt: 'alt' }, children: [] }],
      },
    ],
  }
  // rehype-sanitize のプラグインを呼ぶと transformer が返る
  const transform = rehypeSanitize(SANITIZE_SCHEMA) as (tree: Root) => Root | undefined
  const sanitized = transform(tree) ?? tree
  const paragraph = sanitized.children[0]
  if (paragraph?.type !== 'element') {
    return undefined
  }
  const img = paragraph.children[0]
  if (img?.type !== 'element') {
    return undefined
  }
  return img.properties.src
}

describe('SANITIZE_SCHEMA', () => {
  it('アップロード画像の相対URLはそのまま残る', () => {
    const src = '/api/upload/019fd203-653c-7dc4-8422-4bcbaa3a7ec7.webp'
    expect(sanitizeImgSrc(src)).toBe(src)
  })

  it('httpsの外部URLは残る', () => {
    const src = 'https://example.com/a.png'
    expect(sanitizeImgSrc(src)).toBe(src)
  })

  it.each([
    ['javascript:alert(1)', 'javascriptスキーム'],
    ['data:image/png;base64,AAAA', 'dataスキーム'],
  ])('%s は除去される (%s)', (src) => {
    expect(sanitizeImgSrc(src)).toBeUndefined()
  })

  it('MDXEditor が出力する u タグを許可している', () => {
    expect(SANITIZE_SCHEMA.tagNames).toContain('u')
  })
})
