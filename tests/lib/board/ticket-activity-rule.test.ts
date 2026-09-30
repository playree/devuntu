import {
  ACTIVITY_CONTENT_EXCERPT,
  ACTIVITY_VALUE_MAX,
  criteriaActivity,
  diffTicketSnapshot,
  excerptContent,
  type TicketActivitySnapshot,
} from '@/lib/board/ticket-activity-rule'
import { describe, expect, it } from 'vitest'

const before: TicketActivitySnapshot = {
  title: '件名',
  content: '本文',
  priority: 'medium',
  dueDate: null,
  assignee: { id: null, name: null },
  tagNames: ['A', 'B'],
}

describe('diffTicketSnapshot', () => {
  it('指定しなかった項目・値が同じ項目は記録しない', () => {
    expect(diffTicketSnapshot(before, {})).toEqual([])
    expect(diffTicketSnapshot(before, { title: '件名', priority: 'medium', tagNames: ['B', 'A'] })).toEqual([])
  })

  it('値が変わった項目を変更前後つきで返す', () => {
    expect(
      diffTicketSnapshot(before, {
        title: '新しい件名',
        priority: 'high',
        dueDate: '2026-10-01',
        assignee: { id: 'u1', name: '担当' },
        tagNames: ['A'],
      }),
    ).toEqual([
      { field: 'title', before: '件名', after: '新しい件名' },
      { field: 'priority', before: 'medium', after: 'high' },
      { field: 'dueDate', before: null, after: '2026-10-01' },
      { field: 'assignee', before: null, after: '担当' },
      { field: 'tags', before: 'A, B', after: 'A' },
    ])
  })

  it('担当は名前が同じでも ID が変われば記録する', () => {
    const named = { ...before, assignee: { id: 'a1', name: 'Claude' } }
    expect(diffTicketSnapshot(named, { assignee: { id: 'a2', name: 'Claude' } })).toEqual([
      { field: 'assignee', before: 'Claude', after: 'Claude' },
    ])
    expect(diffTicketSnapshot(named, { assignee: { id: 'a1', name: 'Claude' } })).toEqual([])
  })

  it('空文字と null は同じ値として扱い、クリアは null で残す', () => {
    expect(diffTicketSnapshot({ ...before, content: null }, { content: '' })).toEqual([])
    expect(diffTicketSnapshot(before, { content: '' })).toEqual([{ field: 'content', before: '本文', after: null }])
    expect(diffTicketSnapshot(before, { tagNames: [] })).toEqual([{ field: 'tags', before: 'A, B', after: null }])
  })

  it('本文は全文で比べ、記録には抜粋を残す', () => {
    const long = 'あ'.repeat(ACTIVITY_CONTENT_EXCERPT)
    const [entry] = diffTicketSnapshot({ ...before, content: `${long}1` }, { content: `${long}2` })
    expect(entry).toEqual({ field: 'content', before: `${long}…`, after: `${long}…` })
  })
})

describe('excerptContent', () => {
  it('改行と連続する空白を1つにまとめる', () => {
    expect(excerptContent('一行目\n\n  二行目 ')).toBe('一行目 二行目')
  })

  it('空なら null', () => {
    expect(excerptContent(null)).toBeNull()
    expect(excerptContent(' \n ')).toBeNull()
  })
})

describe('criteriaActivity', () => {
  it('消した / 足した文言を改行区切りで持つ', () => {
    expect(criteriaActivity({ removed: ['旧1', '旧2'], added: ['新'] })).toEqual({
      field: 'criteria',
      before: '旧1\n旧2',
      after: '新',
    })
  })

  it('差分が無ければ記録しない', () => {
    expect(criteriaActivity({ removed: [], added: [] })).toBeNull()
  })

  it('長すぎる値は上限で切る', () => {
    const entry = criteriaActivity({ removed: [], added: ['x'.repeat(ACTIVITY_VALUE_MAX + 10)] })
    expect(entry?.after).toHaveLength(ACTIVITY_VALUE_MAX + 1)
  })
})
