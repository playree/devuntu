/**
 * 通知トリガーの単体テスト
 *
 * このファイルが「どの条件でどのイベントを発火するか」の唯一の判断箇所なので、
 * **発火しない条件**を重点的に固定する(Server Action / MCP の両系統がここに依存している)。
 * 投入から先(宛先の絞り込み・送信)は別のテストで見る。
 */

import {
  enqueueAgentRunFinished,
  enqueueTicketCommented,
  enqueueTicketCreated,
  enqueueTicketUpdated,
  type AgentRunNotification,
} from '@/lib/notify/notify-trigger'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify/notify-enqueue', () => ({ enqueueNotify: vi.fn(async () => undefined) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  },
}))

const { enqueueNotify } = await import('@/lib/notify/notify-enqueue')
const { prisma } = await import('@/lib/prisma')

const enqueue = vi.mocked(enqueueNotify)
const findUser = vi.mocked(prisma.user.findUnique)

const ACTOR = 'user-actor'
const OTHER = 'user-other'

const ticket = {
  id: '0198c0de-0000-7000-8000-000000000001',
  boardId: '0198c0de-0000-7000-8000-0000000000b1',
  displayId: 'ABC-42',
  title: 'ログイン画面の崩れ',
}

/** 投入されたイベントの一覧 */
const events = () => enqueue.mock.calls.map(([param]) => param.event)

/** 指定イベントの投入内容 */
const enqueued = (event: string) => enqueue.mock.calls.find(([param]) => param.event === event)?.[0]

beforeEach(() => {
  vi.clearAllMocks()
  // 表示名の解決 / 担当者の isAgent 判定はどちらも user.findUnique を使う
  findUser.mockResolvedValue({ name: '操作した人', isAgent: false } as never)
})

describe('メンション: 発火しない条件', () => {
  it('増えたメンションが無ければ投入しない', async () => {
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: { assigneeId: OTHER, status: 'todo' },
      after: { assigneeId: OTHER, status: 'todo' },
      addedMentionUserIds: [],
    })
    expect(events()).not.toContain('mention')
  })

  it('自分自身へのメンションだけなら投入しない(自分の書き込みで自分に通知が飛ばない)', async () => {
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: { assigneeId: OTHER, status: 'todo' },
      after: { assigneeId: OTHER, status: 'todo' },
      addedMentionUserIds: [ACTOR],
    })
    expect(events()).not.toContain('mention')
  })
})

describe('メンション: 投入する内容', () => {
  it('自分自身は宛先から外す', async () => {
    await enqueueTicketCreated({
      actorId: ACTOR,
      ticket,
      assigneeId: null,
      status: 'todo',
      mentionedUserIds: [ACTOR, OTHER],
    })
    expect(enqueued('mention')?.targetUserIds).toEqual([OTHER])
  })

  it('チケット本文のメンションはコメントIDを持たない', async () => {
    await enqueueTicketCreated({ actorId: ACTOR, ticket, assigneeId: null, status: 'todo', mentionedUserIds: [OTHER] })
    expect(enqueued('mention')?.payload).not.toHaveProperty('commentId')
  })

  it('コメント経由はコメントIDと抜粋を持つ', async () => {
    await enqueueTicketCommented({
      actorId: ACTOR,
      ticket,
      comment: { id: 'comment-1', content: '## 調査結果\n- **原因** は CSS' },
      addedMentionUserIds: [OTHER],
    })
    expect(enqueued('mention')?.payload).toMatchObject({
      commentId: 'comment-1',
      excerpt: '調査結果 原因 は CSS',
    })
  })

  it('記法だけのコメントは抜粋にしない(落とすと空になるため)', async () => {
    await enqueueTicketCommented({
      actorId: ACTOR,
      ticket,
      comment: { id: 'comment-1', content: '**' },
      addedMentionUserIds: [OTHER],
    })
    expect(enqueued('mention')?.payload).not.toHaveProperty('excerpt')
  })

  it('文面に必要な値をスナップショットする', async () => {
    await enqueueTicketCommented({
      actorId: ACTOR,
      ticket,
      comment: { id: 'comment-1', content: 'テスト' },
      addedMentionUserIds: [OTHER],
    })
    expect(enqueued('mention')?.payload).toMatchObject({
      ticketId: ticket.id,
      displayId: ticket.displayId,
      ticketTitle: ticket.title,
      fromName: '操作した人',
    })
  })
})

describe('担当者の指定: 発火しない条件', () => {
  const state = (assigneeId: string | null) => ({ assigneeId, status: 'todo' }) as const

  it('担当者が変わっていなければ投入しない', async () => {
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: state(OTHER),
      after: state(OTHER),
      addedMentionUserIds: [],
    })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('担当者を外しただけなら投入しない(知らせる相手も内容も無い)', async () => {
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: state(OTHER),
      after: state(null),
      addedMentionUserIds: [],
    })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('自分で自分を担当にしたら DM の宛先を作らない(チャンネルへは知らせる)', async () => {
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: state(null),
      after: state(ACTOR),
      addedMentionUserIds: [],
    })
    expect(enqueued('ticket_assigned')?.targetUserIds).toEqual([])
  })

  it('担当がエージェント用ユーザーなら DM の宛先を作らない(DM を読まない)', async () => {
    findUser.mockResolvedValue({ name: 'エージェント', isAgent: true } as never)
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: state(null),
      after: state(OTHER),
      addedMentionUserIds: [],
    })
    expect(enqueued('ticket_assigned')?.targetUserIds).toEqual([])
  })

  it('担当ユーザーが引けなければ投入しない', async () => {
    findUser.mockResolvedValue(null as never)
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: state(null),
      after: state(OTHER),
      addedMentionUserIds: [],
    })
    expect(events()).not.toContain('ticket_assigned')
  })
})

describe('担当者の指定: 投入する内容', () => {
  it('新しい担当者だけを宛先にする', async () => {
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: { assigneeId: null, status: 'todo' },
      after: { assigneeId: OTHER, status: 'todo' },
      addedMentionUserIds: [],
    })
    expect(enqueued('ticket_assigned')).toMatchObject({
      event: 'ticket_assigned',
      actorId: ACTOR,
      targetUserIds: [OTHER],
      payload: { ticketId: ticket.id, displayId: ticket.displayId, fromName: '操作した人' },
    })
  })

  it('作成時に担当者を付けるのも「指定された」ものとして扱う', async () => {
    await enqueueTicketCreated({ actorId: ACTOR, ticket, assigneeId: OTHER, status: 'todo', mentionedUserIds: [] })
    expect(enqueued('ticket_assigned')?.targetUserIds).toEqual([OTHER])
  })

  it('作成時に担当者を付けなければ担当変更は投入しない', async () => {
    await enqueueTicketCreated({ actorId: ACTOR, ticket, assigneeId: null, status: 'todo', mentionedUserIds: [] })
    expect(events()).not.toContain('ticket_assigned')
  })

  it('メンションと担当変更は別のイベントとして投入する', async () => {
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: { assigneeId: null, status: 'todo' },
      after: { assigneeId: OTHER, status: 'todo' },
      addedMentionUserIds: [OTHER],
    })
    expect(events()).toEqual(['mention', 'ticket_assigned'])
  })
})

describe('コメント: 担当変更は判断しない', () => {
  it('コメントでは担当変更のイベントを投入しない', async () => {
    await enqueueTicketCommented({
      actorId: ACTOR,
      ticket,
      comment: { id: 'comment-1', content: 'テスト' },
      addedMentionUserIds: [OTHER],
    })
    expect(events()).toEqual(['mention'])
  })
})

describe('エージェントの実行終了', () => {
  const startedAt = new Date('2026-08-25T00:00:00Z')

  const notification = (override: Partial<AgentRunNotification> = {}): AgentRunNotification => ({
    runId: 'run1',
    agentName: 'テストエージェント',
    ticket,
    action: 'execute',
    status: 'succeeded',
    summary: '原因を特定して修正した',
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 90_000),
    ...override,
  })

  it('宛先はトリガー側では決めない(依頼者もチャンネルも配信直前に解決する)', async () => {
    await enqueueAgentRunFinished(notification())
    expect(enqueued('agent_run')?.targetUserIds).toBeUndefined()
  })

  it('チャネル通知の宛先を引くためにボードをスナップショットする', async () => {
    await enqueueAgentRunFinished(notification())
    expect(enqueued('agent_run')?.payload).toMatchObject({ boardId: ticket.boardId })
  })

  it('actor を置かない(実行はエージェントだが宛先は依頼者)', async () => {
    await enqueueAgentRunFinished(notification())
    expect(enqueued('agent_run')?.actorId).toBeUndefined()
  })

  it('文面に必要な値をスナップショットする', async () => {
    await enqueueAgentRunFinished(notification())
    expect(enqueued('agent_run')?.payload).toMatchObject({
      ticketId: ticket.id,
      displayId: ticket.displayId,
      ticketTitle: ticket.title,
      agentName: 'テストエージェント',
      action: 'execute',
      status: 'succeeded',
      startedAt,
      excerpt: '原因を特定して修正した',
    })
  })

  it('要約が無ければ抜粋を持たせない', async () => {
    await enqueueAgentRunFinished(notification({ summary: null }))
    expect(enqueued('agent_run')?.payload).not.toHaveProperty('excerpt')
  })
})

describe('作成 / 完了: チャネル通知だけのイベント', () => {
  it('作成すると必ず ticket_created を投入する(宛先はボードの設定次第)', async () => {
    await enqueueTicketCreated({ actorId: ACTOR, ticket, assigneeId: null, status: 'todo', mentionedUserIds: [] })
    expect(events()).toEqual(['ticket_created'])
  })

  it('最初から完了で作ったら完了も投入する', async () => {
    await enqueueTicketCreated({ actorId: ACTOR, ticket, assigneeId: null, status: 'done', mentionedUserIds: [] })
    expect(events()).toEqual(['ticket_created', 'ticket_completed'])
  })

  it('完了レーンへ入った瞬間だけ投入する', async () => {
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: { assigneeId: null, status: 'doing' },
      after: { assigneeId: null, status: 'done' },
      addedMentionUserIds: [],
    })
    expect(events()).toEqual(['ticket_completed'])
  })

  it('完了のまま更新しても投入しない(並べ替えで通知が飛ばない)', async () => {
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: { assigneeId: null, status: 'done' },
      after: { assigneeId: null, status: 'done' },
      addedMentionUserIds: [],
    })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('完了から戻しても投入しない', async () => {
    await enqueueTicketUpdated({
      actorId: ACTOR,
      ticket,
      before: { assigneeId: null, status: 'done' },
      after: { assigneeId: null, status: 'todo' },
      addedMentionUserIds: [],
    })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('DM の宛先は持たない(個人設定では表せない)', async () => {
    await enqueueTicketCreated({ actorId: ACTOR, ticket, assigneeId: null, status: 'todo', mentionedUserIds: [] })
    expect(enqueued('ticket_created')?.targetUserIds).toBeUndefined()
  })

  it('チャネル通知の宛先を引くためにボードをスナップショットする', async () => {
    await enqueueTicketCreated({ actorId: ACTOR, ticket, assigneeId: null, status: 'todo', mentionedUserIds: [] })
    expect(enqueued('ticket_created')?.payload).toMatchObject({
      boardId: ticket.boardId,
      displayId: ticket.displayId,
      fromName: '操作した人',
    })
  })
})
