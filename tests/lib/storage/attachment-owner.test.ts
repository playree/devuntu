/**
 * 添付の持ち主と DB の列の変換(attachment-owner.ts)
 */

import { attachmentOwnerColumns, attachmentTargetFields, storedAttachmentOwnerOf } from '@/lib/storage/attachment-owner'
import { describe, expect, it } from 'vitest'

describe('attachmentOwnerColumns / storedAttachmentOwnerOf', () => {
  it.each([
    [{ kind: 'board', boardId: 'b1' } as const, { boardId: 'b1', wikiSpaceId: null }],
    [{ kind: 'wikiSpace', wikiSpaceId: 's1' } as const, { boardId: null, wikiSpaceId: 's1' }],
    [{ kind: 'public' } as const, { boardId: null, wikiSpaceId: null }],
  ])('%o は列 %o になり、読み戻すと同じ持ち主になる', (owner, columns) => {
    expect(attachmentOwnerColumns(owner)).toEqual(columns)
    expect(storedAttachmentOwnerOf({ ...columns, detachedAt: null })).toEqual(owner)
  })

  it('削除待ちの印があれば、列に関わらず detached(誰にも配信しない)', () => {
    expect(storedAttachmentOwnerOf({ boardId: null, wikiSpaceId: null, detachedAt: new Date() })).toEqual({
      kind: 'detached',
    })
  })
})

describe('attachmentTargetFields', () => {
  it('応答とログに載せる形はボードか Wiki スペースの一方だけ', () => {
    expect(attachmentTargetFields({ kind: 'board', boardId: 'b1' })).toEqual({ boardId: 'b1' })
    expect(attachmentTargetFields({ kind: 'wikiSpace', wikiSpaceId: 's1' })).toEqual({ wikiSpaceId: 's1' })
  })
})
