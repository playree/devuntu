/**
 * Zod スキーマの単体テスト
 *
 * 既定値・必須の境界だけを対象にする(項目ごとの文字数制限は UI の constraintSchema が担う)。
 */

import { ASSIGNEE_NONE } from '@/lib/board/task'
import {
  scCreateTag,
  scCreateTicket,
  scCreateUser,
  scMoveTicket,
  scPatchTicket,
  scTicketSearch,
  scUpdateIntegrationSettings,
  scUpdateNotifySetting,
  scUpdateUser,
  zBoardKey,
  zPassword,
} from '@/lib/schema/schema'
import { describe, expect, it } from 'vitest'

const boardId = '01920000-0000-7000-8000-000000000001'
const ticketId = '01920000-0000-7000-8000-000000000002'
const userId = '01920000-0000-7000-8000-000000000003'

describe('scCreateTicket: priority は必須(既定 medium)', () => {
  it('priority 未指定なら medium になる', () => {
    const res = scCreateTicket.parse({ boardId, title: 'タイトル' })
    expect(res.priority).toBe('medium')
    expect(res.status, 'status の既定は todo').toBe('todo')
  })

  it('明示指定した優先度はそのまま通る', () => {
    expect(scCreateTicket.parse({ boardId, title: 'x', priority: 'urgent' }).priority).toBe('urgent')
  })

  it('null は受け付けない(クリア不可の項目)', () => {
    expect(scCreateTicket.safeParse({ boardId, title: 'x', priority: null }).success).toBe(false)
  })

  it('未知の値は受け付けない', () => {
    expect(scCreateTicket.safeParse({ boardId, title: 'x', priority: 'highest' }).success).toBe(false)
  })
})

describe('scPatchTicket: 渡された項目だけを更新する', () => {
  it('未指定の項目には既定値を入れない', () => {
    const res = scPatchTicket.parse({ id: ticketId })
    expect(res.priority, '既定値を補うと無変更のはずの項目を上書きしてしまう').toBeUndefined()
    expect(res.title).toBeUndefined()
    expect(res.tagIds).toBeUndefined()
  })

  it('null はクリアとして受け付ける(期日・担当者)', () => {
    const res = scPatchTicket.parse({ id: ticketId, dueDate: null, assigneeId: null })
    expect(res.dueDate).toBeNull()
    expect(res.assigneeId).toBeNull()
  })

  it('クリア不可の項目に null は受け付けない', () => {
    expect(scPatchTicket.safeParse({ id: ticketId, priority: null }).success, '優先度').toBe(false)
    expect(scPatchTicket.safeParse({ id: ticketId, title: null }).success, '件名').toBe(false)
  })
})

describe('zDueDate: 期日は YYYY-MM-DD の実在する日付のみ', () => {
  const parseDueDate = (dueDate: string) => scPatchTicket.safeParse({ id: ticketId, dueDate }).success

  it('実在する日付は受け付ける', () => {
    expect(parseDueDate('2026-01-15')).toBe(true)
    expect(parseDueDate('2024-02-29'), '閏年の 2/29').toBe(true)
  })

  it('桁数は正しいが存在しない日付は受け付けない', () => {
    expect(parseDueDate('2026-02-31'), '2月31日').toBe(false)
    expect(parseDueDate('2026-02-29'), '平年の 2/29').toBe(false)
    expect(parseDueDate('2026-13-01'), '13月').toBe(false)
  })

  it('区切りが違う形式は受け付けない', () => {
    expect(parseDueDate('2026/01/01')).toBe(false)
    expect(parseDueDate('20260101')).toBe(false)
  })
})

describe('scTicketSearch: 担当者は未選択 / 未割り当て / userId', () => {
  const parseAssignee = (assignee: unknown) => scTicketSearch.safeParse({ assignee })

  it('未指定・null は「すべて」として通す', () => {
    expect(scTicketSearch.parse({}).assignee, '未指定').toBeUndefined()
    expect(scTicketSearch.parse({ assignee: null }).assignee, 'null').toBeNull()
  })

  it('未割り当てのセンチネルと userId を受け付ける', () => {
    expect(parseAssignee(ASSIGNEE_NONE).success, '未割り当て').toBe(true)
    expect(parseAssignee(userId).success, 'userId').toBe(true)
  })

  it('userId でもセンチネルでもない文字列は受け付けない', () => {
    expect(parseAssignee('me').success, '旧仕様の me').toBe(false)
    expect(parseAssignee('any').success, '旧仕様の any').toBe(false)
  })
})

describe('scCreateUser / scUpdateUser: エージェント専用ドメインは人間のユーザーに使わせない', () => {
  const createUser = (email: string) => scCreateUser.safeParse({ name: 'テスト', email, isAdmin: false })
  const updateUser = (email: string) =>
    scUpdateUser.safeParse({ id: userId, name: 'テスト', email, isAdmin: false, nameLocked: false, groups: [] })

  it('通常のメールアドレスは通す', () => {
    expect(createUser('user@example.com').success, '作成').toBe(true)
    expect(updateUser('user@example.com').success, '更新').toBe(true)
  })

  it('agents.invalid のアドレスは弾く', () => {
    expect(createUser('bot@agents.invalid').success, '作成').toBe(false)
    expect(updateUser('bot@agents.invalid').success, '更新').toBe(false)
  })
})

describe('scMoveTicket', () => {
  it('レーン内位置は 0 以上の整数のみ', () => {
    expect(scMoveTicket.parse({ id: ticketId, status: 'doing', index: 0 }).index).toBe(0)
    expect(scMoveTicket.safeParse({ id: ticketId, status: 'doing', index: -1 }).success, '負数').toBe(false)
    expect(scMoveTicket.safeParse({ id: ticketId, status: 'doing', index: 1.5 }).success, '小数').toBe(false)
  })

  it('未知のステータスは受け付けない', () => {
    expect(scMoveTicket.safeParse({ id: ticketId, status: 'unknown', index: 0 }).success).toBe(false)
  })
})

describe('zBoardKey: ボードキーの入力チェック', () => {
  it('英大文字と数字の2〜8文字を通し、小文字は大文字へ寄せる', () => {
    expect(zBoardKey.parse('DEV')).toBe('DEV')
    expect(zBoardKey.parse(' dev1 '), 'trim + 大文字化').toBe('DEV1')
    expect(zBoardKey.parse('ABCDEFGH'), '上限ちょうど').toBe('ABCDEFGH')
  })

  it('形式外は受け付けない', () => {
    expect(zBoardKey.safeParse('D').success, '短すぎる').toBe(false)
    expect(zBoardKey.safeParse('ABCDEFGHI').success, '長すぎる').toBe(false)
    expect(zBoardKey.safeParse('1DEV').success, '数字始まり').toBe(false)
    expect(zBoardKey.safeParse('DE-V').success, '記号').toBe(false)
  })

  it('PRV で始まるキーは予約済みなので弾く', () => {
    // 通してしまうと nextSequentialKey が採番不能になり、プライベートボード未作成の
    // 全ユーザーで ensurePrivateBoard が恒久的に失敗する
    expect(zBoardKey.safeParse('PRV99999').success).toBe(false)
    expect(zBoardKey.safeParse('prv1').success, '小文字で入力しても弾く').toBe(false)
    expect(zBoardKey.safeParse('PRVX').success).toBe(false)
    expect(zBoardKey.safeParse('PR1').success, '接頭辞が一致しなければ通る').toBe(true)
  })

  it('予約キーのエラーメッセージは専用のロケールキーになる', () => {
    const res = zBoardKey.safeParse('PRV1')
    expect(res.error?.issues[0]?.message).toBe('@reserved_board_key')
  })
})

describe('zPassword: 長さのみで判定する', () => {
  it('8〜128文字を受け付ける', () => {
    expect(zPassword.safeParse('a'.repeat(8)).success).toBe(true)
    expect(zPassword.safeParse('a'.repeat(128)).success).toBe(true)
  })

  it('境界外は受け付けない', () => {
    expect(zPassword.safeParse('a'.repeat(7)).success).toBe(false)
    expect(zPassword.safeParse('a'.repeat(129)).success, 'better-auth の上限に合わせる').toBe(false)
  })

  it('パスフレーズやパスワードマネージャの生成値を文字種で弾かない', () => {
    expect(zPassword.safeParse('correct horse battery staple').success).toBe(true)
    expect(zPassword.safeParse('パスフレーズを使いたい').success).toBe(true)
    expect(zPassword.safeParse('Xk#9vQ2~mL8•pR4').success).toBe(true)
  })
})

describe('scCreateTag: 表示順は未指定と 0 を区別する', () => {
  it('未指定なら undefined のまま(サーバー側で末尾へ採番する)', () => {
    expect(scCreateTag.parse({ boardId, name: 'タグ' }).order).toBeUndefined()
  })

  it('0 を明示したら 0 のまま通す', () => {
    // 既定値を持たせると 0 が採番へ流れて先頭固定にできなくなる
    expect(scCreateTag.parse({ boardId, name: 'タグ', order: 0 }).order).toBe(0)
  })

  it('色は未指定なら gray', () => {
    expect(scCreateTag.parse({ boardId, name: 'タグ' }).color).toBe('gray')
  })
})

describe('scUpdateIntegrationSettings: 許可グループはグループIDの配列', () => {
  it('空配列(全ユーザー許可)を通す', () => {
    expect(scUpdateIntegrationSettings.safeParse({ enabled: true, allowedGroupIds: [] }).success).toBe(true)
  })

  it('uuidv7 でない値は弾く', () => {
    expect(scUpdateIntegrationSettings.safeParse({ enabled: true, allowedGroupIds: ['not-a-uuid'] }).success).toBe(
      false,
    )
  })
})

describe('scUpdateNotifySetting: 通知イベントは enum で受ける', () => {
  it('既知のイベントを通す', () => {
    expect(scUpdateNotifySetting.safeParse({ event: 'mention', email: true, slack: false }).success).toBe(true)
  })

  it('未知のイベントは弾く', () => {
    // NOTIFY_EVENTS から生成しているので、Prisma に種別を足せば自動で追従する
    expect(scUpdateNotifySetting.safeParse({ event: 'assigned', email: true, slack: true }).success).toBe(false)
  })

  it('チャネルの指定漏れは弾く', () => {
    // 部分更新を許すとサーバー側に「未指定なら据え置き」の分岐が必要になるので全部必須にしている
    expect(scUpdateNotifySetting.safeParse({ event: 'mention', slack: true }).success).toBe(false)
    expect(scUpdateNotifySetting.safeParse({ event: 'mention', email: true }).success).toBe(false)
  })
})
