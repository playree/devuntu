/**
 * Wiki のページテンプレートのプレースホルダー(wiki-template-rule.ts)
 */

import { applyWikiTemplatePlaceholders } from '@/lib/wiki/wiki-template-rule'
import { describe, expect, it } from 'vitest'

// UTC では 2026-11-30 15:30。東京(UTC+9)では翌日 12-01 になる
const now = new Date('2026-11-30T15:30:00Z')

describe('applyWikiTemplatePlaceholders', () => {
  it('{{date}} / {{month}} / {{user}} を作成者のタイムゾーンの日付と表示名に置き換える', () => {
    expect(
      applyWikiTemplatePlaceholders('{{date}} 定例 ({{month}}) by {{user}}', {
        now,
        timezone: 'Asia/Tokyo',
        userName: '作成者A',
      }),
    ).toBe('2026-12-01 定例 (2026-12) by 作成者A')
  })

  it('タイムゾーンで日付と月が変わる', () => {
    expect(
      applyWikiTemplatePlaceholders('{{date}} {{month}}', { now, timezone: 'America/New_York', userName: '' }),
    ).toBe('2026-11-30 2026-11')
  })

  it('同じプレースホルダーが何度出てもすべて置き換える', () => {
    expect(applyWikiTemplatePlaceholders('{{user}}/{{user}}', { now, timezone: 'UTC', userName: 'a' })).toBe('a/a')
  })

  it('知らない {{...}} と空白入りの書き方は残す', () => {
    expect(applyWikiTemplatePlaceholders('{{foo}} {{ date }} {date}', { now, timezone: 'UTC', userName: 'a' })).toBe(
      '{{foo}} {{ date }} {date}',
    )
  })

  it('表示名に含まれるプレースホルダーは置き換え直さない', () => {
    expect(applyWikiTemplatePlaceholders('{{user}}', { now, timezone: 'UTC', userName: '{{date}}' })).toBe('{{date}}')
  })
})
