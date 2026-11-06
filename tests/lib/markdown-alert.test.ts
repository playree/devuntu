/**
 * GitHub 形式の注意書き(`> [!NOTE]`)の目印の判定と、書き出し時のエスケープ戻しの単体テスト
 *
 * import visitor / toMarkdown ハンドラ自体は Lexical と DOM を要し vitest(environment: node)からは動かせないため、
 * 目印の扱いを固定する。
 */

import { ALERT_TYPES, parseAlertMarker, unescapeAlertMarker } from '@/lib/markdown-alert'
import { describe, expect, it } from 'vitest'

describe('parseAlertMarker', () => {
  it.each(ALERT_TYPES)('%s の目印と後ろのテキストを返す', (type) => {
    expect(parseAlertMarker(`[!${type.toUpperCase()}]\n本文`)).toEqual({ type, rest: '本文' })
  })

  it('大文字小文字を問わない', () => {
    expect(parseAlertMarker('[!Warning]\n本文')).toEqual({ type: 'warning', rest: '本文' })
  })

  it('目印だけの行(後ろに空白)も受け付ける', () => {
    expect(parseAlertMarker('[!TIP]  ')).toEqual({ type: 'tip', rest: '' })
  })

  it.each([
    ['同じ行に本文が続く', '[!NOTE] 本文'],
    ['未知の種類', '[!INFO]\n本文'],
    ['先頭以外の目印', '本文\n[!NOTE]'],
    ['! が無い', '[NOTE]\n本文'],
  ])('%s場合は undefined', (_, text) => {
    expect(parseAlertMarker(text)).toBeUndefined()
  })
})

describe('unescapeAlertMarker', () => {
  it('引用の先頭でエスケープされた目印を戻す', () => {
    expect(unescapeAlertMarker('> \\[!NOTE]\n> 本文')).toBe('> [!NOTE]\n> 本文')
  })

  it('小文字の目印も戻す', () => {
    expect(unescapeAlertMarker('> \\[!caution]\n>\n> 本文')).toBe('> [!caution]\n>\n> 本文')
  })

  it.each([
    ['本文中のエスケープ', '> 本文\n> \\[!NOTE]'],
    ['同じ行に本文が続く目印', '> \\[!NOTE] 本文'],
    ['未知の種類', '> \\[!INFO]\n> 本文'],
  ])('%sには触れない', (_, markdown) => {
    expect(unescapeAlertMarker(markdown)).toBe(markdown)
  })
})
