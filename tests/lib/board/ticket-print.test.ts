/**
 * チケットの印刷用ページ(`board/ticket-print.ts`)の単体テスト
 */

import { findPrintableComment, ticketPrintPath, ticketPrintTitle } from '@/lib/board/ticket-print'
import { describe, expect, it } from 'vitest'

describe('ticketPrintPath: 印刷用ページのパス', () => {
  it('コメント指定なしはチケット全体', () => {
    expect(ticketPrintPath('t1')).toBe('/print/tickets/t1')
  })

  it('コメント指定ありはクエリに付ける', () => {
    expect(ticketPrintPath('t1', 'c1')).toBe('/print/tickets/t1?comment=c1')
  })

  it('パスとクエリの値はエンコードする', () => {
    expect(ticketPrintPath('a/b', 'c&d')).toBe('/print/tickets/a%2Fb?comment=c%26d')
  })
})

describe('ticketPrintTitle: 文書タイトル(保存ファイル名の既定)', () => {
  it('チケット全体は表示IDと件名', () => {
    expect(ticketPrintTitle({ displayId: 'DEV-12', title: '件名' })).toBe('DEV-12 件名')
  })

  it('プラン/報告書の単体は表示IDと種別名', () => {
    expect(ticketPrintTitle({ displayId: 'DEV-12', title: '件名', typeLabel: 'プラン' })).toBe('DEV-12 プラン')
  })
})

describe('findPrintableComment: 印刷できるコメントの検索', () => {
  const comments = [
    {
      id: 'plan',
      type: 'plan',
      replies: [
        { id: 'reply', type: null },
        { id: 'reply-report', type: 'report' },
      ],
    },
    { id: 'normal', type: null, replies: [] },
  ]

  it('プラン/報告書は返す', () => {
    expect(findPrintableComment(comments, 'plan')?.id).toBe('plan')
  })

  it('返信のプラン/報告書も探す', () => {
    expect(findPrintableComment(comments, 'reply-report')?.id).toBe('reply-report')
  })

  it('通常のコメントは null', () => {
    expect(findPrintableComment(comments, 'normal')).toBeNull()
    expect(findPrintableComment(comments, 'reply')).toBeNull()
  })

  it('見つからなければ null', () => {
    expect(findPrintableComment(comments, 'missing')).toBeNull()
  })
})
