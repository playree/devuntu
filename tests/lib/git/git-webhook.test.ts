/**
 * Webhook の受け口で引いたボードを、イベントの対象の形にする変換
 *
 * provider ごとの設定(BoardGitSetting)の行があればその値を、無ければ既定値(すべてオフ)を使うことを検証する。
 */

import { toGitLinkedBoard } from '@/lib/git/git-webhook'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/board/board-repository', () => ({ gitlabBaseUrls: () => [] }))
vi.mock('@/lib/board/ticket-mutation', () => ({ completeTicketByMerge: vi.fn() }))

describe('toGitLinkedBoard', () => {
  it('設定の行があればその値を使う', () => {
    expect(
      toGitLinkedBoard({
        id: 'board-1',
        key: 'ABC',
        gitSettings: [{ completeOnMerge: true, mergeCriteriaCheck: 'checked', autoRevise: true, autoReviseLimit: 5 }],
      }),
    ).toEqual({
      id: 'board-1',
      key: 'ABC',
      completeOnPrMerge: true,
      mergeCriteriaCheck: 'checked',
      autoRevise: true,
      autoReviseLimit: 5,
    })
  })

  it('設定の行が無ければマージで完了・自動差し戻しともオフにし、受け入れ条件は人の確認か自己申告で判定する', () => {
    expect(toGitLinkedBoard({ id: 'board-1', key: 'ABC', gitSettings: [] })).toEqual({
      id: 'board-1',
      key: 'ABC',
      completeOnPrMerge: false,
      mergeCriteriaCheck: 'checkedOrReported',
      autoRevise: false,
      autoReviseLimit: 3,
    })
  })
})
