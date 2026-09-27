/**
 * ボードのロールとチケット権限の判定(`board/ticket-permission.ts`)の単体テスト
 *
 * prisma を型のみ参照する純粋関数なので、DB を起動せずに検証できる。
 */

import {
  canApplyAssignments,
  canMcpDeleteTicket,
  canMcpUpdateTicket,
  evaluateTicketAccess,
  resolveBoardRole,
  type BoardRole,
} from '@/lib/board/ticket-permission'
import { describe, expect, it } from 'vitest'

/* -------------------------------------------------------------------------------------------------
 * 権限
 * -----------------------------------------------------------------------------------------------*/

describe('resolveBoardRole: ボードの実効ロール解決', () => {
  const cases: { label: string; direct: BoardRole | null; group: boolean; expected: BoardRole | null }[] = [
    { label: '直接 owner', direct: 'owner', group: false, expected: 'owner' },
    { label: '直接 member', direct: 'member', group: false, expected: 'member' },
    { label: 'グループ経由のみ', direct: null, group: true, expected: 'member' },
    { label: 'どちらも無し', direct: null, group: false, expected: null },
    { label: '直接 member + グループ経由', direct: 'member', group: true, expected: 'member' },
    { label: '直接 owner + グループ経由(owner を維持)', direct: 'owner', group: true, expected: 'owner' },
  ]

  for (const { label, direct, group, expected } of cases) {
    it(label, () => {
      expect(resolveBoardRole(direct, group), `${label} は ${expected} になる`).toBe(expected)
    })
  }
})

describe('evaluateTicketAccess: ボードのロールから権限を決める', () => {
  // プライベートチケットもプライベートボード(本人が owner)に属するため、
  // 「本人のみ全操作可」は boardRole='owner' のケースでそのまま担保される
  it('owner は削除まで可能', () => {
    const res = evaluateTicketAccess({
      userId: 'u1',
      createdById: 'u9',
      boardRole: 'owner',
      archived: false,
      isAgentApprover: false,
    })
    expect(res).toEqual({ canView: true, canEdit: true, canDelete: true, canEditAgentMode: false })
  })

  it('プライベートボード相当(自分が owner かつ作成者)は全操作可', () => {
    const res = evaluateTicketAccess({
      userId: 'u1',
      createdById: 'u1',
      boardRole: 'owner',
      archived: false,
      isAgentApprover: false,
    })
    expect(res, 'プライベートチケットの従来挙動と一致する').toEqual({
      canView: true,
      canEdit: true,
      canDelete: true,
      canEditAgentMode: false,
    })
  })

  it('member かつ作成者なら削除可能', () => {
    const res = evaluateTicketAccess({
      userId: 'u1',
      createdById: 'u1',
      boardRole: 'member',
      archived: false,
      isAgentApprover: false,
    })
    expect(res.canDelete, '自分が作成したチケットは削除できる').toBe(true)
  })

  it('member かつ非作成者は削除不可(閲覧・編集は可能)', () => {
    const res = evaluateTicketAccess({
      userId: 'u1',
      createdById: 'u9',
      boardRole: 'member',
      archived: false,
      isAgentApprover: false,
    })
    expect(res).toEqual({ canView: true, canEdit: true, canDelete: false, canEditAgentMode: false })
  })

  it('非メンバー(boardRole=null)は作成者でも一切不可', () => {
    const res = evaluateTicketAccess({
      userId: 'u1',
      createdById: 'u1',
      boardRole: null,
      archived: false,
      isAgentApprover: false,
    })
    expect(res).toEqual({ canView: false, canEdit: false, canDelete: false, canEditAgentMode: false })
  })

  it('アーカイブ済みボードは owner でも読み取り専用', () => {
    const res = evaluateTicketAccess({
      userId: 'u1',
      createdById: 'u1',
      boardRole: 'owner',
      archived: true,
      isAgentApprover: false,
    })
    expect(res, 'アーカイブ解除はボード設定側の権限なのでチケットは書けない').toEqual({
      canView: true,
      canEdit: false,
      canDelete: false,
      canEditAgentMode: false,
    })
  })

  it('アーカイブ済みボードは member でも書き込み不可', () => {
    const res = evaluateTicketAccess({
      userId: 'u1',
      createdById: 'u1',
      boardRole: 'member',
      archived: true,
      isAgentApprover: false,
    })
    expect(res).toEqual({ canView: true, canEdit: false, canDelete: false, canEditAgentMode: false })
  })

  it('承認者は非メンバーでも閲覧とエージェントモードの変更ができる', () => {
    const res = evaluateTicketAccess({
      userId: 'u1',
      createdById: 'u9',
      boardRole: null,
      archived: false,
      isAgentApprover: true,
    })
    expect(res, 'エージェントモード以外の編集はボード権限に従う').toEqual({
      canView: true,
      canEdit: false,
      canDelete: false,
      canEditAgentMode: true,
    })
  })

  it('承認者でない owner はエージェントモードを変更できない', () => {
    const res = evaluateTicketAccess({
      userId: 'u1',
      createdById: 'u1',
      boardRole: 'owner',
      archived: false,
      isAgentApprover: false,
    })
    expect(res.canEditAgentMode, '承認者が0人ならボードの owner でも承認できない').toBe(false)
  })

  it('アーカイブ済みボードは承認者でもエージェントモードを変更できない', () => {
    const res = evaluateTicketAccess({
      userId: 'u1',
      createdById: 'u9',
      boardRole: 'owner',
      archived: true,
      isAgentApprover: true,
    })
    expect(res).toEqual({ canView: true, canEdit: false, canDelete: false, canEditAgentMode: false })
  })
})

describe('canMcpUpdateTicket: MCP限定の追加制限(担当者以外は更新不可)', () => {
  it('owner は他人担当のチケットでも更新できる', () => {
    expect(canMcpUpdateTicket({ userId: 'u1', boardRole: 'owner', assigneeId: 'u9' })).toBe(true)
  })

  it('member は他人担当のチケットを更新できない', () => {
    expect(canMcpUpdateTicket({ userId: 'u1', boardRole: 'member', assigneeId: 'u9' })).toBe(false)
  })

  it('member は未割り当てのチケットを更新できる', () => {
    expect(canMcpUpdateTicket({ userId: 'u1', boardRole: 'member', assigneeId: null })).toBe(true)
  })

  it('member は自分が担当のチケットを更新できる', () => {
    expect(canMcpUpdateTicket({ userId: 'u1', boardRole: 'member', assigneeId: 'u1' })).toBe(true)
  })
})

describe('canMcpDeleteTicket: MCP限定の追加制限(作成者以外は削除不可)', () => {
  it('作成者本人は削除できる', () => {
    expect(canMcpDeleteTicket({ userId: 'u1', createdById: 'u1' })).toBe(true)
  })

  it('作成者以外は owner でも削除できない(Web版の canDelete より厳しい)', () => {
    expect(canMcpDeleteTicket({ userId: 'u1', createdById: 'u9' })).toBe(false)
  })

  it('作成者不明(createdById=null)は削除できない', () => {
    expect(canMcpDeleteTicket({ userId: 'u1', createdById: null })).toBe(false)
  })
})

describe('canApplyAssignments: ボードのアサイン', () => {
  it('owner が 0 人になるアサインは owner 自身には許可しない', () => {
    expect(canApplyAssignments({ ownerIds: [], byAdmin: false }), 'owner 操作では拒否').toBe(false)
    expect(canApplyAssignments({ ownerIds: [], byAdmin: true }), '管理者操作では許可').toBe(true)
    expect(canApplyAssignments({ ownerIds: ['u1'], byAdmin: false }), 'owner が 1 人以上なら許可').toBe(true)
  })
})
