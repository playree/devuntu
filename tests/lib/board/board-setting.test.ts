/**
 * ボード設定の処理の単体テスト
 *
 * 権限の検証を必ず先に通すこと、キー変更時だけ予約すること、
 * 存在しないチャンネルを保存しないこと、添付の実体をコミット後に消すことを固定する。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertBoardAccess: vi.fn(),
  assertTeamBoard: vi.fn(),
  reserveBoardKey: vi.fn(),
  rethrowDuplicatedBoardKey: vi.fn((e: unknown) => {
    throw e
  }),
  isGitlabVisible: vi.fn(),
  countTicketsByBoard: vi.fn(),
  getSlackSettings: vi.fn(),
  hasSlackCredentials: vi.fn(),
  listSlackChannels: vi.fn(),
  getBoardNotifySetting: vi.fn(),
  setBoardNotifySetting: vi.fn(),
  detachBoardAttachments: vi.fn(),
  listBoardAttachmentKeys: vi.fn(),
  removeAttachmentByKey: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ board: ['findUnique', 'update', 'delete'] }),
)
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))
vi.mock('@/lib/board/board-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/board/board-access')>()),
  assertBoardAccess: mocks.assertBoardAccess,
  assertTeamBoard: mocks.assertTeamBoard,
}))
vi.mock('@/lib/board/board-key', () => ({
  reserveBoardKey: mocks.reserveBoardKey,
  rethrowDuplicatedBoardKey: mocks.rethrowDuplicatedBoardKey,
}))
vi.mock('@/lib/board/board-repository', () => ({ isGitlabVisible: mocks.isGitlabVisible }))
vi.mock('@/lib/board/board', () => ({ countTicketsByBoard: mocks.countTicketsByBoard }))
vi.mock('@/lib/slack/slack-account', () => ({
  getSlackSettings: mocks.getSlackSettings,
  hasSlackCredentials: mocks.hasSlackCredentials,
}))
vi.mock('@/lib/slack/slack-server', () => ({ listSlackChannels: mocks.listSlackChannels }))
vi.mock('@/lib/notify/notify-board-setting', () => ({
  getBoardNotifySetting: mocks.getBoardNotifySetting,
  setBoardNotifySetting: mocks.setBoardNotifySetting,
}))
vi.mock('@/lib/storage/attachment', () => ({
  detachBoardAttachments: mocks.detachBoardAttachments,
  listBoardAttachmentKeys: mocks.listBoardAttachmentKeys,
  removeAttachmentByKey: mocks.removeAttachmentByKey,
}))

const {
  assertBoardNotifyManageable,
  deleteBoard,
  getBoardDetail,
  getBoardNotify,
  setBoardArchivedState,
  setBoardNotify,
  updateBoardProfile,
} = await import('@/lib/board/board-setting')

const board = vi.mocked(prisma.board)

const user = { id: 'u1', role: 'user' }
const admin = { id: 'a1', role: 'admin' }

const boardRow = {
  id: 'b1',
  kind: 'team',
  key: 'ABC',
  name: 'ボード',
  description: '説明',
  archived: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

const denied = new Error('denied')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.assertBoardAccess.mockResolvedValue({ boardId: 'b1', kind: 'team', role: 'owner', via: 'member' })
  mocks.assertTeamBoard.mockResolvedValue(undefined)
  mocks.countTicketsByBoard.mockResolvedValue({})
  mocks.hasSlackCredentials.mockReturnValue(true)
  mocks.getSlackSettings.mockResolvedValue({ enabled: true, allowedGroupIds: [] })
  mocks.isGitlabVisible.mockResolvedValue(false)
  mocks.listSlackChannels.mockResolvedValue([{ id: 'C1', name: 'general' }])
  mocks.listBoardAttachmentKeys.mockResolvedValue([])
  board.findUnique.mockResolvedValue(boardRow as never)
  board.update.mockResolvedValue({ id: 'b1', name: 'ボード' } as never)
  board.delete.mockResolvedValue({} as never)
})

describe('getBoardDetail', () => {
  it('閲覧権限を検証してから概要を返す', async () => {
    const detail = await getBoardDetail(user, 'b1')

    expect(mocks.assertBoardAccess).toHaveBeenCalledWith(user, 'b1', 'view')
    expect(detail).toMatchObject({
      id: 'b1',
      key: 'ABC',
      name: 'ボード',
      description: '説明',
      role: 'owner',
      via: 'member',
    })
  })

  it('閲覧権限が無ければ投げ、ボードを引かない', async () => {
    mocks.assertBoardAccess.mockRejectedValue(denied)

    await expect(getBoardDetail(user, 'b1')).rejects.toBe(denied)
    expect(board.findUnique).not.toHaveBeenCalled()
  })

  it('ボードが無ければ不正な操作として投げる', async () => {
    board.findUnique.mockResolvedValue(null)

    await expect(getBoardDetail(user, 'b1')).rejects.toMatchObject({ errorType: 'INVALID_OPERATION' })
  })

  it('説明が null なら空文字にする', async () => {
    board.findUnique.mockResolvedValue({ ...boardRow, description: null } as never)

    expect((await getBoardDetail(user, 'b1')).description).toBe('')
  })

  it.each([
    ['owner', user, 'owner', true, false],
    ['member', user, 'member', false, false],
    ['管理者(member)', admin, 'member', true, true],
  ] as const)('%s の管理可否と管理者フラグ', async (_, actor, role, canManage, isAdmin) => {
    mocks.assertBoardAccess.mockResolvedValue({ boardId: 'b1', role, via: 'member' })

    expect(await getBoardDetail(actor, 'b1')).toMatchObject({ canManage, isAdmin })
  })

  it.each([
    ['認証情報あり・有効', true, true, true],
    ['認証情報なし', false, true, false],
    ['無効', true, false, false],
  ])('チャネル通知の表示可否(%s)', async (_, credentials, enabled, expected) => {
    mocks.hasSlackCredentials.mockReturnValue(credentials)
    mocks.getSlackSettings.mockResolvedValue({ enabled, allowedGroupIds: [] })

    expect((await getBoardDetail(user, 'b1')).slackEnabled).toBe(expected)
  })

  it('GitLab 連携の表示可否をそのまま返す', async () => {
    mocks.isGitlabVisible.mockResolvedValue(true)

    expect((await getBoardDetail(user, 'b1')).gitlabVisible).toBe(true)
    expect(mocks.isGitlabVisible).toHaveBeenCalledWith('b1')
  })

  it('チケット数は全ステータスを埋め、無いものは 0 にする', async () => {
    mocks.countTicketsByBoard.mockResolvedValue({ b1: { todo: 3, done: 1 } })

    expect((await getBoardDetail(user, 'b1')).ticketCounts).toEqual({ backlog: 0, todo: 3, doing: 0, done: 1 })
    expect(mocks.countTicketsByBoard).toHaveBeenCalledWith(['b1'])
  })

  it('チケットが 1 件も無ければ全ステータス 0', async () => {
    expect((await getBoardDetail(user, 'b1')).ticketCounts).toEqual({ backlog: 0, todo: 0, doing: 0, done: 0 })
  })
})

describe('updateBoardProfile', () => {
  const input = { id: 'b1', name: '新しい名前', key: 'ABC', description: '新しい説明' }

  it('管理権限とチームボードを検証してから更新する', async () => {
    const result = await updateBoardProfile(user, input)

    expect(mocks.assertBoardAccess).toHaveBeenCalledWith(user, 'b1', 'manage', prisma)
    expect(mocks.assertTeamBoard).toHaveBeenCalledWith(prisma, 'b1')
    expect(board.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { name: '新しい名前', key: 'ABC', description: '新しい説明' },
      select: { id: true, name: true },
    })
    expect(result).toEqual({ id: 'b1', name: 'ボード' })
  })

  it('キーが変わらなければ予約しない', async () => {
    await updateBoardProfile(user, input)

    expect(mocks.reserveBoardKey).not.toHaveBeenCalled()
  })

  it('キーが変わるときは自分のボードIDを添えて予約する', async () => {
    await updateBoardProfile(user, { ...input, key: 'XYZ' })

    expect(mocks.reserveBoardKey).toHaveBeenCalledWith(prisma, 'XYZ', 'b1')
  })

  it('予約に失敗したら更新しない', async () => {
    const error = new Error('reserved')
    mocks.reserveBoardKey.mockRejectedValue(error)

    await expect(updateBoardProfile(user, { ...input, key: 'XYZ' })).rejects.toBe(error)
    expect(board.update).not.toHaveBeenCalled()
  })

  it('現在のボードが引けなければ予約せずに更新へ進む', async () => {
    board.findUnique.mockResolvedValue(null)

    await updateBoardProfile(user, { ...input, key: 'XYZ' })

    expect(mocks.reserveBoardKey).not.toHaveBeenCalled()
    expect(board.update).toHaveBeenCalled()
  })

  it('更新の失敗はキー重複の変換を通して投げる', async () => {
    const error = new Error('P2002')
    board.update.mockRejectedValue(error)

    await expect(updateBoardProfile(user, input)).rejects.toBe(error)
    expect(mocks.rethrowDuplicatedBoardKey).toHaveBeenCalledWith(error)
  })

  it.each([
    ['管理権限が無い', () => mocks.assertBoardAccess.mockRejectedValue(denied)],
    ['プライベートボード', () => mocks.assertTeamBoard.mockRejectedValue(denied)],
  ])('%sなら更新しない', async (_, arrange) => {
    arrange()

    await expect(updateBoardProfile(user, input)).rejects.toBe(denied)
    expect(board.update).not.toHaveBeenCalled()
  })
})

describe('setBoardArchivedState', () => {
  it.each([true, false])('archived(%s)だけを更新する', async (archived) => {
    await setBoardArchivedState(user, 'b1', archived)

    expect(mocks.assertBoardAccess).toHaveBeenCalledWith(user, 'b1', 'manage', prisma)
    expect(board.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { archived }, select: { id: true } })
  })

  it('プライベートボードなら更新しない', async () => {
    mocks.assertTeamBoard.mockRejectedValue(denied)

    await expect(setBoardArchivedState(user, 'b1', true)).rejects.toBe(denied)
    expect(board.update).not.toHaveBeenCalled()
  })
})

describe('assertBoardNotifyManageable', () => {
  it('渡した接続で管理権限とチームボードを検証する', async () => {
    const tx = {} as never

    await assertBoardNotifyManageable(user, 'b1', tx)

    expect(mocks.assertBoardAccess).toHaveBeenCalledWith(user, 'b1', 'manage', tx)
    expect(mocks.assertTeamBoard).toHaveBeenCalledWith(tx, 'b1')
  })
})

describe('getBoardNotify', () => {
  it('権限を確定してから現在値を返す', async () => {
    mocks.getBoardNotifySetting.mockResolvedValue({ slackChannelId: 'C1', events: [] })

    expect(await getBoardNotify(user, 'b1')).toEqual({ slackChannelId: 'C1', events: [] })
    expect(mocks.getBoardNotifySetting).toHaveBeenCalledWith('b1')
  })

  it('権限が無ければ設定を引かない', async () => {
    mocks.assertTeamBoard.mockRejectedValue(denied)

    await expect(getBoardNotify(user, 'b1')).rejects.toBe(denied)
    expect(mocks.getBoardNotifySetting).not.toHaveBeenCalled()
  })
})

describe('setBoardNotify', () => {
  const events: NotifyEvent[] = ['ticket_created']

  it('一覧にあるチャンネルなら保存する', async () => {
    await setBoardNotify(user, { id: 'b1', slackChannelId: 'C1', events })

    expect(mocks.setBoardNotifySetting).toHaveBeenCalledWith('b1', { slackChannelId: 'C1', events }, prisma)
  })

  it('トランザクション内でも権限を検証し直す', async () => {
    await setBoardNotify(user, { id: 'b1', slackChannelId: 'C1', events })

    expect(mocks.assertBoardAccess).toHaveBeenCalledTimes(2)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('通知先が空なら一覧と突き合わせず、null で保存する', async () => {
    await setBoardNotify(user, { id: 'b1', slackChannelId: '', events })

    expect(mocks.listSlackChannels).not.toHaveBeenCalled()
    expect(mocks.setBoardNotifySetting).toHaveBeenCalledWith('b1', { slackChannelId: null, events }, prisma)
  })

  it.each([
    ['一覧に無い', [{ id: 'C2', name: 'other' }]],
    ['一覧が取れない', null],
  ])('%sチャンネルは入力エラーにして保存しない', async (_, channels) => {
    mocks.listSlackChannels.mockResolvedValue(channels)

    await expect(setBoardNotify(user, { id: 'b1', slackChannelId: 'C1', events })).rejects.toMatchObject({
      errorType: 'VALIDATION_ERROR',
    })
    expect(mocks.setBoardNotifySetting).not.toHaveBeenCalled()
  })

  it('権限が無ければチャンネル一覧を引かない', async () => {
    mocks.assertBoardAccess.mockRejectedValue(denied)

    await expect(setBoardNotify(user, { id: 'b1', slackChannelId: 'C1', events })).rejects.toBe(denied)
    expect(mocks.listSlackChannels).not.toHaveBeenCalled()
  })

  it('確定後に権限が外れていれば保存しない', async () => {
    mocks.assertBoardAccess.mockResolvedValueOnce({ role: 'owner' }).mockRejectedValueOnce(denied)

    await expect(setBoardNotify(user, { id: 'b1', slackChannelId: 'C1', events })).rejects.toBe(denied)
    expect(mocks.setBoardNotifySetting).not.toHaveBeenCalled()
  })
})

describe('deleteBoard', () => {
  it('キーを控えてから紐付けを外し、ボードを消す', async () => {
    const order: string[] = []
    mocks.listBoardAttachmentKeys.mockImplementation(async () => {
      order.push('list')
      return []
    })
    mocks.detachBoardAttachments.mockImplementation(async () => {
      order.push('detach')
    })
    board.delete.mockImplementation((async () => {
      order.push('delete')
    }) as never)

    await deleteBoard(user, 'b1')

    expect(order).toEqual(['list', 'detach', 'delete'])
    expect(board.delete).toHaveBeenCalledWith({ where: { id: 'b1' } })
  })

  it('コミット後に添付の実体を 1 つずつ消し、消せた数をログに残す', async () => {
    mocks.listBoardAttachmentKeys.mockResolvedValue(['k1', 'k2', 'k3'])
    mocks.removeAttachmentByKey.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await deleteBoard(user, 'b1')

    expect(mocks.removeAttachmentByKey.mock.calls).toEqual([['k1'], ['k2'], ['k3']])
    expect(mocks.logger.info).toHaveBeenCalledWith(
      { userId: 'u1', id: 'b1', attachments: 3, removed: 2 },
      'board deleted',
    )
  })

  it('ボードの削除に失敗したら実体は消さない', async () => {
    const error = new Error('db')
    mocks.listBoardAttachmentKeys.mockResolvedValue(['k1'])
    board.delete.mockRejectedValue(error)

    await expect(deleteBoard(user, 'b1')).rejects.toBe(error)
    expect(mocks.removeAttachmentByKey).not.toHaveBeenCalled()
  })

  it.each([
    ['管理権限が無い', () => mocks.assertBoardAccess.mockRejectedValue(denied)],
    ['プライベートボード', () => mocks.assertTeamBoard.mockRejectedValue(denied)],
  ])('%sなら何も消さない', async (_, arrange) => {
    arrange()

    await expect(deleteBoard(user, 'b1')).rejects.toBe(denied)
    expect(mocks.detachBoardAttachments).not.toHaveBeenCalled()
    expect(board.delete).not.toHaveBeenCalled()
  })
})
