/** ボードグループの総入れ替え。存在確認は重複を畳んで数えるので、書き込みも畳む */

import { syncBoardGroups } from '@/lib/board/board-member'
import { describe, expect, it, vi } from 'vitest'

const fakeTx = () => ({
  boardGroup: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
})

describe('syncBoardGroups', () => {
  it('重複したグループは 1 件にまとめて書く(一意制約で落とさない)', async () => {
    const tx = fakeTx()
    await syncBoardGroups(tx as never, 'b1', ['g1', 'g1', 'g2'])

    expect(tx.boardGroup.deleteMany).toHaveBeenCalledWith({ where: { boardId: 'b1' } })
    expect(tx.boardGroup.createMany).toHaveBeenCalledWith({
      data: [
        { boardId: 'b1', groupId: 'g1' },
        { boardId: 'b1', groupId: 'g2' },
      ],
    })
  })

  it('空なら消すだけ', async () => {
    const tx = fakeTx()
    await syncBoardGroups(tx as never, 'b1', [])

    expect(tx.boardGroup.deleteMany).toHaveBeenCalled()
    expect(tx.boardGroup.createMany).not.toHaveBeenCalled()
  })
})
