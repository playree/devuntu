import { assertReplyTarget } from '@/lib/board/board'
import { ClientError } from '@/lib/error'
import { describe, expect, it, vi } from 'vitest'

const fakeTx = (parent: { ticketId: string; parentId: string | null } | null) =>
  ({
    ticketComment: { findUnique: vi.fn().mockResolvedValue(parent) },
  }) as never

describe('assertReplyTarget', () => {
  it('返信先が同一チケットのトップレベルコメントなら通す', async () => {
    await expect(
      assertReplyTarget(fakeTx({ ticketId: 'ticket-1', parentId: null }), 'ticket-1', 'comment-1'),
    ).resolves.toBeUndefined()
  })

  it('返信先が存在しなければ拒否する', async () => {
    await expect(assertReplyTarget(fakeTx(null), 'ticket-1', 'comment-1')).rejects.toThrow(ClientError)
  })

  it('返信先が既に返信(parentId あり)なら拒否する(2階層目を禁止)', async () => {
    await expect(
      assertReplyTarget(fakeTx({ ticketId: 'ticket-1', parentId: 'comment-0' }), 'ticket-1', 'comment-1'),
    ).rejects.toThrow(ClientError)
  })

  it('返信先が別チケットのコメントなら拒否する', async () => {
    await expect(
      assertReplyTarget(fakeTx({ ticketId: 'ticket-2', parentId: null }), 'ticket-1', 'comment-1'),
    ).rejects.toThrow(ClientError)
  })
})
