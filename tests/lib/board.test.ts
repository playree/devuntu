/**
 * assertReplyTarget: コメントの返信スレッドは 1 階層のみ許容する。
 * 返信先が存在しない、または返信先自体が既に返信(parentId を持つ)場合は errInvalidOperation を throw する。
 */

import { assertReplyTarget } from '@/lib/board'
import { ClientError } from '@/lib/error'
import { describe, expect, it, vi } from 'vitest'

const fakeTx = (parent: { parentId: string | null } | null) =>
  ({
    ticketComment: { findUnique: vi.fn().mockResolvedValue(parent) },
  }) as never

describe('assertReplyTarget', () => {
  it('返信先がトップレベルのコメントなら通す', async () => {
    await expect(assertReplyTarget(fakeTx({ parentId: null }), 'comment-1')).resolves.toBeUndefined()
  })

  it('返信先が存在しなければ拒否する', async () => {
    await expect(assertReplyTarget(fakeTx(null), 'comment-1')).rejects.toThrow(ClientError)
  })

  it('返信先が既に返信(parentId あり)なら拒否する(2階層目を禁止)', async () => {
    await expect(assertReplyTarget(fakeTx({ parentId: 'comment-0' }), 'comment-1')).rejects.toThrow(ClientError)
  })
})
