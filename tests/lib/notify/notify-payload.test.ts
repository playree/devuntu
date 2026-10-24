/**
 * 通知ペイロードの単体テスト
 *
 * 型の網羅は `satisfies Record<NotifyEvent, ...>` が保証するので、ここでは
 * 実行時にも全イベントが定義されていることと、壊れた行を弾けることを見る。
 */

import { NotifyEvent } from '@/generated/prisma/enums'
import { ClientError } from '@/lib/error'
import { NOTIFY_PAYLOAD_SCHEMA, parseNotifyPayload } from '@/lib/notify/notify-payload'
import { describe, expect, it } from 'vitest'

const ticketRef = {
  ticketId: '0198c0de-0000-7000-8000-000000000001',
  displayId: 'ABC-42',
  ticketTitle: 'ログイン画面のレイアウト崩れ',
}

describe('NOTIFY_PAYLOAD_SCHEMA: 全イベントが定義されていること', () => {
  it('Prisma の NotifyEvent を網羅する', () => {
    expect(Object.keys(NOTIFY_PAYLOAD_SCHEMA).sort()).toEqual(Object.values(NotifyEvent).sort())
  })
})

describe('parseNotifyPayload: mention', () => {
  it('必須の値だけで通る', () => {
    const payload = { ...ticketRef, fromName: 'テストユーザー' }
    expect(parseNotifyPayload('mention', payload)).toMatchObject(payload)
  })

  it('コメントIDと抜粋は任意', () => {
    const parsed = parseNotifyPayload('mention', {
      ...ticketRef,
      fromName: 'テストユーザー',
      commentId: 'comment-1',
      excerpt: 'iOS だけで再現',
    })
    expect(parsed.commentId).toBe('comment-1')
    expect(parsed.excerpt).toBe('iOS だけで再現')
  })

  it('表示IDが無い行は弾く(件名を組み立てられない)', () => {
    expect(() => parseNotifyPayload('mention', { ...ticketRef, displayId: '', fromName: 'x' })).toThrow(ClientError)
  })
})

describe('parseNotifyPayload: agent_run', () => {
  const payload = {
    ...ticketRef,
    runId: 'run1',
    agentName: 'テストエージェント',
    action: 'execute',
    status: 'succeeded',
    startedAt: '2026-08-25T00:00:00.000Z',
    finishedAt: '2026-08-25T00:01:30.000Z',
  }

  it('Json を経由して文字列になった日時を Date へ戻す', () => {
    const parsed = parseNotifyPayload('agent_run', payload)
    expect(parsed.startedAt).toBeInstanceOf(Date)
    expect(parsed.finishedAt.getTime() - parsed.startedAt.getTime()).toBe(90_000)
  })

  it('終了していない状態は受け取らない(終了時のみ通知する)', () => {
    expect(() => parseNotifyPayload('agent_run', { ...payload, status: 'running' })).toThrow(ClientError)
  })

  it('未知の処理種別は弾く', () => {
    expect(() => parseNotifyPayload('agent_run', { ...payload, action: 'unknown' })).toThrow(ClientError)
  })
})

describe('parseNotifyPayload: ticket_merge_held', () => {
  const payload = { ...ticketRef, pullRequest: 'owner/repo#12', unmetCount: 2 }

  it('PR / MR と未達の件数で通る', () => {
    expect(parseNotifyPayload('ticket_merge_held', payload)).toMatchObject(payload)
  })

  it('未達が0件の行は弾く(保留していない)', () => {
    expect(() => parseNotifyPayload('ticket_merge_held', { ...payload, unmetCount: 0 })).toThrow(ClientError)
  })
})

describe('parseNotifyPayload: ticket_due', () => {
  const payload = { ...ticketRef, kind: 'due_day', dueDate: '2026-10-20' }

  it('種類と期日で通る', () => {
    expect(parseNotifyPayload('ticket_due', payload)).toMatchObject(payload)
  })

  it('未知の種類・日付でない期日は弾く', () => {
    expect(() => parseNotifyPayload('ticket_due', { ...payload, kind: 'overdue' })).toThrow(ClientError)
    expect(() => parseNotifyPayload('ticket_due', { ...payload, dueDate: '2026-10-20T00:00:00Z' })).toThrow(ClientError)
  })
})

describe('parseNotifyPayload: announcement', () => {
  const payload = { ...ticketRef, commentId: 'comment-1', fromName: 'テストユーザー', excerpt: 'v1.0.0\n• 機能A' }

  it('コメントIDと本文で通る(改行を保つ)', () => {
    expect(parseNotifyPayload('announcement', payload)).toMatchObject(payload)
  })

  it('本文が空・コメントIDが無い行は弾く', () => {
    expect(() => parseNotifyPayload('announcement', { ...payload, excerpt: '' })).toThrow(ClientError)
    expect(() => parseNotifyPayload('announcement', { ...payload, commentId: undefined })).toThrow(ClientError)
  })
})
