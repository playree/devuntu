import { assertReplyTarget, reassignContentAttachments } from '@/lib/board/board'
import { ClientError } from '@/lib/error'
import { toUploadUrl } from '@/lib/storage/upload'
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

/**
 * 添付の付け替えは「まだどの本文からも使われていないもの」に限る。
 * 使用中のものを動かすと元のボードのメンバーからその本文の画像が読めなくなるため。
 */
describe('reassignContentAttachments', () => {
  const KEY = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'
  const BOARD_ID = '019eef64-6cc1-78f1-8f50-1ef869860002'
  const actor = { id: 'u1' }
  const content = `本文\n![shot](${toUploadUrl(KEY)})`

  const fakeAttachmentTx = (options: { candidates?: { key: string }[]; ticket?: object; comment?: object } = {}) => {
    const tx = {
      attachment: {
        findMany: vi.fn().mockResolvedValue(options.candidates ?? [{ key: KEY }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      ticket: { findFirst: vi.fn().mockResolvedValue(options.ticket ?? null) },
      ticketComment: { findFirst: vi.fn().mockResolvedValue(options.comment ?? null) },
    }
    return tx
  }

  it('本文に画像が無ければ添付を引かない', async () => {
    const tx = fakeAttachmentTx()
    await reassignContentAttachments(tx as never, '画像なしの本文', BOARD_ID, actor)

    expect(tx.attachment.findMany).not.toHaveBeenCalled()
    expect(tx.attachment.updateMany).not.toHaveBeenCalled()
  })

  it('別ボードの自分の添付で未使用なら付け替える', async () => {
    const tx = fakeAttachmentTx()
    await reassignContentAttachments(tx as never, content, BOARD_ID, actor)

    expect(tx.attachment.findMany).toHaveBeenCalledWith({
      where: { key: { in: [KEY] }, createdById: 'u1', boardId: { not: BOARD_ID } },
      select: { key: true },
    })
    expect(tx.attachment.updateMany).toHaveBeenCalledWith({
      where: { key: { in: [KEY] } },
      data: { boardId: BOARD_ID },
    })
  })

  it('保存先と同じボードの添付は候補にならず、何も更新しない', async () => {
    const tx = fakeAttachmentTx({ candidates: [] })
    await reassignContentAttachments(tx as never, content, BOARD_ID, actor)

    expect(tx.ticket.findFirst).not.toHaveBeenCalled()
    expect(tx.attachment.updateMany).not.toHaveBeenCalled()
  })

  it('他のチケット本文から使われていれば付け替えない', async () => {
    const tx = fakeAttachmentTx({ ticket: { id: 'other-ticket' } })
    await reassignContentAttachments(tx as never, content, BOARD_ID, actor)

    expect(tx.attachment.updateMany).not.toHaveBeenCalled()
  })

  it('他のチケットのコメントから使われていれば付け替えない', async () => {
    const tx = fakeAttachmentTx({ comment: { id: 'other-comment' } })
    await reassignContentAttachments(tx as never, content, BOARD_ID, actor)

    expect(tx.attachment.updateMany).not.toHaveBeenCalled()
  })

  it('保存対象のチケットとそのコメントは使用中に数えない', async () => {
    const tx = fakeAttachmentTx()
    await reassignContentAttachments(tx as never, content, BOARD_ID, actor, 'ticket-1')

    expect(tx.ticket.findFirst).toHaveBeenCalledWith({
      where: { content: { contains: toUploadUrl(KEY) }, id: { not: 'ticket-1' } },
      select: { id: true },
    })
    expect(tx.ticketComment.findFirst).toHaveBeenCalledWith({
      where: { content: { contains: toUploadUrl(KEY) }, ticketId: { not: 'ticket-1' } },
      select: { id: true },
    })
    expect(tx.attachment.updateMany).toHaveBeenCalled()
  })
})
