/**
 * Slack のリンク展開の単体テスト
 *
 * 展開結果はチャンネルの全員に見えるので、貼った本人が見られないチケットの中身を返さないことが要点。
 * 認可の判定(`board-access.ts`)と Slack API は差し替え、「どの段階で打ち切るか」と
 * 「chat.unfurl に何を渡すか」を固定する。
 */

import { findTicketIdByDisplayId, getTicketAccess } from '@/lib/board/board-access'
import { prisma } from '@/lib/prisma'
import { canUseSlackAccount } from '@/lib/slack/slack-account'
import { unfurlSlackLinks } from '@/lib/slack/slack-server'
import { handleSlackLinkShared, type SlackLinkSharedEvent } from '@/lib/slack/slack-unfurl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    account: ['findFirst'],
    user: ['findUnique'],
    ticket: ['findUnique'],
  }),
)
vi.mock('@/lib/board/board-access', () => ({
  findTicketIdByDisplayId: vi.fn(),
  getTicketAccess: vi.fn(),
}))
vi.mock('@/lib/slack/slack-account', () => ({ canUseSlackAccount: vi.fn() }))
vi.mock('@/lib/slack/slack-server', () => ({ unfurlSlackLinks: vi.fn(async () => 'ok') }))

const findAccount = vi.mocked(prisma.account.findFirst)
const findUser = vi.mocked(prisma.user.findUnique)
const findTicket = vi.mocked(prisma.ticket.findUnique)
const findByDisplayId = vi.mocked(findTicketIdByDisplayId)
const access = vi.mocked(getTicketAccess)
const canUse = vi.mocked(canUseSlackAccount)
const unfurl = vi.mocked(unfurlSlackLinks)

const BASE = 'http://localhost:3000'
const TICKET_ID = '0198c0de-0000-7000-8000-000000000001'
const OTHER_TICKET_ID = '0198c0de-0000-7000-8000-000000000002'

const sharedBy = { id: 'user-1', role: 'user', locale: 'ja' }

const ticketRow = (override: Record<string, unknown> = {}) => ({
  number: 42,
  title: 'ログイン画面のレイアウト崩れ',
  status: 'doing',
  priority: 'high',
  dueDate: null,
  board: { key: 'ABC', kind: 'team' },
  assignee: { name: 'テストユーザー' },
  ...override,
})

const event = (override: Partial<SlackLinkSharedEvent> = {}): SlackLinkSharedEvent => ({
  user: 'U0123ABCD',
  channel: 'C0123ABCD',
  message_ts: '1700000000.000100',
  unfurl_id: 'unfurl-1',
  source: 'conversations_history',
  is_bot_user_member: true,
  links: [{ url: `${BASE}/t/ABC-42` }],
  ...override,
})

/** chat.unfurl に渡した map */
const unfurled = () => unfurl.mock.calls[0]?.[1] as Record<string, { blocks: unknown[] }>

beforeEach(() => {
  vi.clearAllMocks()
  findAccount.mockResolvedValue({ userId: 'user-1' } as never)
  canUse.mockResolvedValue(true)
  findUser.mockResolvedValue({ ...sharedBy, banned: false } as never)
  findByDisplayId.mockResolvedValue(TICKET_ID)
  access.mockResolvedValue({ canView: true } as never)
  findTicket.mockResolvedValue(ticketRow() as never)
})

describe('handleSlackLinkShared: 閲覧できるチケットだけを展開する', () => {
  it('閲覧できるチケットは正規形の短縮URLと中身で展開する', async () => {
    await handleSlackLinkShared(event({ links: [{ url: `${BASE}/t/abc-42?x=1` }] }))

    expect(findByDisplayId).toHaveBeenCalledWith(sharedBy, 'abc-42')
    expect(access).toHaveBeenCalledWith(sharedBy, TICKET_ID)
    expect(unfurl).toHaveBeenCalledTimes(1)
    const text = JSON.stringify(unfurled()[`${BASE}/t/abc-42?x=1`].blocks)
    expect(text, '貼られた表記ではなく正規形の表示IDで出す').toContain(`${BASE}/t/ABC-42`)
    expect(text).toContain('ログイン画面のレイアウト崩れ')
    expect(text).toContain('テストユーザー')
  })

  it('詳細URL(/tickets/<uuid>)は表示IDを引かずにチケットIDで判定する', async () => {
    await handleSlackLinkShared(event({ links: [{ url: `${BASE}/tickets/${TICKET_ID}` }] }))

    expect(findByDisplayId).not.toHaveBeenCalled()
    expect(access).toHaveBeenCalledWith(sharedBy, TICKET_ID)
    expect(Object.keys(unfurled())).toEqual([`${BASE}/tickets/${TICKET_ID}`])
  })

  it('表示IDが引けない(未存在・ボードに入れない)なら展開しない', async () => {
    findByDisplayId.mockResolvedValue(null)
    await handleSlackLinkShared(event())

    expect(findTicket).not.toHaveBeenCalled()
    expect(unfurl).not.toHaveBeenCalled()
  })

  it('チケット単位で閲覧できないなら中身を引かずに展開しない', async () => {
    access.mockResolvedValue({ canView: false } as never)
    await handleSlackLinkShared(event())

    expect(findTicket).not.toHaveBeenCalled()
    expect(unfurl).not.toHaveBeenCalled()
  })

  it('アクセス判定が null(チケットが無い)なら展開しない', async () => {
    access.mockResolvedValue(null)
    await handleSlackLinkShared(event())

    expect(unfurl).not.toHaveBeenCalled()
  })

  it('プライベートボードのチケットは本人が見られても展開しない', async () => {
    findTicket.mockResolvedValue(ticketRow({ board: { key: 'PRV1', kind: 'private' } }) as never)
    await handleSlackLinkShared(event())

    expect(unfurl).not.toHaveBeenCalled()
  })

  it('判定の直後に削除されたチケットは展開しない', async () => {
    findTicket.mockResolvedValue(null)
    await handleSlackLinkShared(event())

    expect(unfurl).not.toHaveBeenCalled()
  })

  it('見られるものと見られないものが混ざれば、見られるものだけを渡す', async () => {
    access.mockImplementation(async (_user, ticketId) => ({ canView: ticketId === TICKET_ID }) as never)
    await handleSlackLinkShared(
      event({
        links: [{ url: `${BASE}/tickets/${OTHER_TICKET_ID}` }, { url: `${BASE}/tickets/${TICKET_ID}` }],
      }),
    )

    expect(Object.keys(unfurled())).toEqual([`${BASE}/tickets/${TICKET_ID}`])
  })
})

describe('handleSlackLinkShared: 貼った本人を解決できなければ展開しない', () => {
  it('Slack アカウントが未連携なら何も引かない', async () => {
    findAccount.mockResolvedValue(null)
    await handleSlackLinkShared(event())

    expect(canUse).not.toHaveBeenCalled()
    expect(access).not.toHaveBeenCalled()
    expect(unfurl).not.toHaveBeenCalled()
  })

  it('管理者の無効化・許可グループ外なら展開しない', async () => {
    canUse.mockResolvedValue(false)
    await handleSlackLinkShared(event())

    expect(findUser).not.toHaveBeenCalled()
    expect(unfurl).not.toHaveBeenCalled()
  })

  it('利用停止中のユーザーは Web で読めないので Slack でも展開しない', async () => {
    findUser.mockResolvedValue({ ...sharedBy, banned: true } as never)
    await handleSlackLinkShared(event())

    expect(access).not.toHaveBeenCalled()
    expect(unfurl).not.toHaveBeenCalled()
  })

  it('連携先のユーザーが削除済みなら展開しない', async () => {
    findUser.mockResolvedValue(null)
    await handleSlackLinkShared(event())

    expect(unfurl).not.toHaveBeenCalled()
  })

  it('連携の照会は Slack ユーザーIDで行う', async () => {
    await handleSlackLinkShared(event())

    expect(findAccount.mock.calls[0][0]).toMatchObject({ where: { providerId: 'slack', accountId: 'U0123ABCD' } })
  })
})

describe('handleSlackLinkShared: イベントの前提を満たさなければ何も引かない', () => {
  it.each<[string, Partial<SlackLinkSharedEvent>]>([
    ['貼った人が居ない(Bot の投稿など)', { user: undefined }],
    ['リンクが無い', { links: [] }],
    ['Bot がチャンネルに参加していない', { is_bot_user_member: false }],
    ['展開先が決まらない', { unfurl_id: undefined, message_ts: undefined }],
    ['入力中で unfurl_id が無い(COMPOSER は実在のチャンネルではない)', { unfurl_id: undefined, channel: 'COMPOSER' }],
  ])('%s', async (_label, override) => {
    await handleSlackLinkShared(event(override))

    expect(findAccount).not.toHaveBeenCalled()
    expect(unfurl).not.toHaveBeenCalled()
  })

  it('自サイトのチケットURLが無ければ認可まで進まない', async () => {
    await handleSlackLinkShared(
      event({
        links: [
          { url: 'https://other.example.com/t/ABC-42' },
          { url: `${BASE}/boards` },
          { url: `${BASE}/tickets/not-a-uuid` },
          {},
        ],
      }),
    )

    expect(findByDisplayId).not.toHaveBeenCalled()
    expect(access).not.toHaveBeenCalled()
    expect(unfurl).not.toHaveBeenCalled()
  })
})

describe('handleSlackLinkShared: 照会の回数と展開先', () => {
  it('同じ URL を複数回貼られても照会は 1 度', async () => {
    const url = `${BASE}/t/ABC-42`
    await handleSlackLinkShared(event({ links: [{ url }, { url }, { url }] }))

    expect(access).toHaveBeenCalledTimes(1)
  })

  it('1 メッセージで展開するのは先頭 5 件まで', async () => {
    const links = Array.from({ length: 7 }, (_, index) => ({ url: `${BASE}/t/ABC-${index + 1}` }))
    await handleSlackLinkShared(event({ links }))

    expect(access).toHaveBeenCalledTimes(5)
    expect(Object.keys(unfurled())).toEqual(links.slice(0, 5).map(({ url }) => url))
  })

  it('unfurl_id と source があればそれを展開先にする', async () => {
    await handleSlackLinkShared(event())

    expect(unfurl.mock.calls[0][0]).toEqual({ unfurlId: 'unfurl-1', source: 'conversations_history' })
  })

  it('unfurl_id が無ければ channel + message_ts を展開先にする', async () => {
    await handleSlackLinkShared(event({ unfurl_id: undefined }))

    expect(unfurl.mock.calls[0][0]).toEqual({ channel: 'C0123ABCD', ts: '1700000000.000100' })
  })

  it('入力中(COMPOSER)でも unfurl_id があれば展開する', async () => {
    await handleSlackLinkShared(event({ channel: 'COMPOSER', source: 'composer', message_ts: undefined }))

    expect(unfurl.mock.calls[0][0]).toEqual({ unfurlId: 'unfurl-1', source: 'composer' })
  })

  it('is_bot_user_member が省略されていれば参加扱いで展開する', async () => {
    await handleSlackLinkShared(event({ is_bot_user_member: undefined }))

    expect(unfurl).toHaveBeenCalledTimes(1)
  })
})
