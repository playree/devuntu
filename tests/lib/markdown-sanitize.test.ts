/**
 * Markdown 中の生HTMLの許可リストの単体テスト
 *
 * MDXEditor は許可タグの一覧に `script` / `style` / `iframe` を含み、属性も
 * 検査せずに DOM へ渡すため、ここで絞り込めていないと表示・編集の両方で
 * スクリプトが実行される。無害化の実体は Lexical と DOM を要する import visitor で
 * vitest(environment: node)からは動かせないので、その入力になる許可リストを固定する。
 */

import { ALLOWED_HTML_TAGS, isAllowedHtmlTag, isDroppedHtmlTag } from '@/lib/markdown-sanitize'
import { describe, expect, it } from 'vitest'

describe('ALLOWED_HTML_TAGS', () => {
  it.each(['script', 'style', 'iframe', 'object', 'embed', 'form', 'a', 'img', 'div', 'span'])(
    '%s は許可しない',
    (tag) => {
      expect(isAllowedHtmlTag(tag)).toBe(false)
    },
  )

  it('MDXEditor が下線として出力する u タグを許可している', () => {
    expect(isAllowedHtmlTag('u')).toBe(true)
  })

  it.each(['br', 's', 'del', 'ins', 'mark', 'kbd', 'sub', 'sup'])('%s は許可する', (tag) => {
    expect(isAllowedHtmlTag(tag)).toBe(true)
  })

  it('名前が無いノードは許可しない', () => {
    expect(isAllowedHtmlTag(null)).toBe(false)
    expect(isAllowedHtmlTag(undefined)).toBe(false)
    expect(isAllowedHtmlTag('')).toBe(false)
  })

  it.each(['script', 'style', 'noscript', 'template', 'title', 'textarea'])('%s は中身ごと捨てる', (tag) => {
    expect(isDroppedHtmlTag(tag)).toBe(true)
  })

  it('許可タグと中身ごと捨てるタグは重ならない', () => {
    expect([...ALLOWED_HTML_TAGS].filter(isDroppedHtmlTag)).toEqual([])
  })

  it('属性が無くても意味が保てるタグだけを並べている', () => {
    // 許可を広げるときは属性を全て捨てても壊れないかを確認する
    expect([...ALLOWED_HTML_TAGS].toSorted()).toEqual(['br', 'del', 'ins', 'kbd', 'mark', 's', 'sub', 'sup', 'u'])
  })
})
