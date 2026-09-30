import { applyTicketTemplate, filterTemplateTagIds } from '@/lib/board/ticket-template-rule'
import { describe, expect, it } from 'vitest'

const template = {
  content: '## 再現手順',
  criteria: ['再現しない'],
  tagIds: ['tag-1'],
  priority: 'high' as const,
}

describe('applyTicketTemplate', () => {
  it('指定の無い項目をテンプレートで埋める', () => {
    expect(applyTicketTemplate({ title: 'A' }, template)).toEqual({
      title: 'A',
      content: '## 再現手順',
      criteria: ['再現しない'],
      tagIds: ['tag-1'],
      priority: 'high',
    })
  })

  it('明示した項目はテンプレートより優先する(空文字・空配列も明示として扱う)', () => {
    expect(
      applyTicketTemplate({ title: 'A', content: '', criteria: [], tagIds: [], priority: 'low' }, template),
    ).toEqual({ title: 'A', content: '', criteria: [], tagIds: [], priority: 'low' })
  })

  it('テンプレートの優先度が未指定なら medium にする', () => {
    expect(applyTicketTemplate({ title: 'A' }, { ...template, priority: null }).priority).toBe('medium')
  })

  it('テンプレートが無ければ従来の既定値(medium / タグなし)にする', () => {
    expect(applyTicketTemplate({ title: 'A' }, null)).toEqual({
      title: 'A',
      content: undefined,
      criteria: undefined,
      tagIds: [],
      priority: 'medium',
    })
  })
})

describe('filterTemplateTagIds', () => {
  it('ボードに無くなったタグを外し、並びは保つ', () => {
    expect(filterTemplateTagIds(['t3', 'gone', 't1'], ['t1', 't2', 't3'])).toEqual(['t3', 't1'])
  })
})
