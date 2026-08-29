/**
 * タスク管理(チケット / ボード)のドメインロジックの単体テスト
 *
 * `src/lib/task.ts` は prisma を型のみ参照する純粋関数の集まりなので、
 * DB やネットワークを起動せずに検証できる(vitest の environment は node)。
 */

import type { TicketStatus } from '@/generated/prisma/enums'
import {
  applyLaneMove,
  ASSIGNEE_NONE,
  buildTicketWhere,
  canApplyAssignments,
  canMcpDeleteTicket,
  canMcpUpdateTicket,
  cardDropId,
  commentAnchorId,
  countLaneMap,
  defaultKanbanFilter,
  emptyLaneMap,
  evaluateTicketAccess,
  extractMentionEmails,
  filterLaneMap,
  filterMentionCandidates,
  findMentions,
  formatMentionSource,
  groupByLane,
  insertAt,
  isKanbanFilterActive,
  isReservedBoardKey,
  KANBAN_DONE_DAYS_OPTIONS,
  KANBAN_DONE_VISIBLE_DAYS,
  kanbanDoneSince,
  kanbanLaneWhere,
  kanbanTicketWhere,
  laneDropId,
  matchesKanbanFilter,
  matchMentionTrigger,
  MENTION_CANDIDATE_LIMIT,
  MENTION_EMAIL_MAX,
  nextOrder,
  nextSequentialKey,
  normalizeMentionText,
  parseDropTarget,
  parseTicketDisplayId,
  parseTicketNumber,
  parseTicketUrl,
  reindexLane,
  resolveBoardRole,
  resolveMentionUserIds,
  splitKeywords,
  stripCodeSpans,
  tagNamesWhere,
  TICKET_SORT_COLUMNS,
  TICKET_STATUSES,
  ticketDisplayId,
  ticketListOrderBy,
  ticketScopeWhere,
  ticketShortPath,
  type BoardRole,
  type KanbanFilterCard,
  type LaneMap,
  type TicketSearchParams,
} from '@/lib/board/task'
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

/* -------------------------------------------------------------------------------------------------
 * 表示ID
 * -----------------------------------------------------------------------------------------------*/

describe('ticketDisplayId / parseTicketDisplayId: 表示IDの組み立てと分解', () => {
  it('ボードキーと番号をハイフンで繋ぐ', () => {
    expect(ticketDisplayId({ key: 'DEV', number: 12 })).toBe('DEV-12')
  })

  it('組み立てた表示IDはそのまま読み戻せる', () => {
    expect(parseTicketDisplayId(ticketDisplayId({ key: 'DEV', number: 12 }))).toEqual({ key: 'DEV', number: 12 })
  })

  it('小文字で貼られてもキーは大文字へ寄せる', () => {
    expect(parseTicketDisplayId('dev-12')).toEqual({ key: 'DEV', number: 12 })
  })

  it('前後の空白は無視する', () => {
    expect(parseTicketDisplayId(' DEV-12 ')).toEqual({ key: 'DEV', number: 12 })
  })

  it('形式外は null', () => {
    expect(parseTicketDisplayId('DEV'), 'キーだけ').toBeNull()
    expect(parseTicketDisplayId('12'), '番号だけ').toBeNull()
    expect(parseTicketDisplayId('1DEV-12'), '数字始まりのキー').toBeNull()
    expect(parseTicketDisplayId('D-12'), '1 文字のキー').toBeNull()
    expect(parseTicketDisplayId('TOOLONGKEY-12'), '8 文字を超えるキー').toBeNull()
    expect(parseTicketDisplayId('DEV-0012345678'), 'Int に収まらない桁数').toBeNull()
    expect(parseTicketDisplayId('DEV-12 の件'), '後ろに文字が続く').toBeNull()
  })
})

describe('ticketShortPath / parseTicketUrl: チャットに貼られたチケットURLの解決', () => {
  const BASE = 'https://devuntu.example.com'
  /** 実際のチケットID(uuid v7)と同じ形 */
  const TICKET_ID = '019fb795-5ac1-745c-91f0-c6aa35077d64'
  const byDisplayId = { kind: 'displayId', value: 'DEV-12' }
  const byTicketId = { kind: 'ticketId', value: TICKET_ID }

  it('組み立てた短縮URLはそのまま読み戻せる', () => {
    expect(parseTicketUrl(`${BASE}${ticketShortPath('DEV-12')}`, BASE)).toEqual(byDisplayId)
  })

  it('チケット詳細URLはチケットIDとして解決する(アドレスバーからコピーした形)', () => {
    expect(parseTicketUrl(`${BASE}/tickets/${TICKET_ID}`, BASE)).toEqual(byTicketId)
  })

  it('ベースURLにパスが付いていてもオリジンで判定する', () => {
    expect(parseTicketUrl(`${BASE}/t/DEV-12`, `${BASE}/auth/signin`)).toEqual(byDisplayId)
  })

  it('クエリやフラグメントが付いていても解決できる', () => {
    expect(parseTicketUrl(`${BASE}/t/DEV-12?from=slack#comment`, BASE), '短縮URL').toEqual(byDisplayId)
    expect(parseTicketUrl(`${BASE}/tickets/${TICKET_ID}?from=slack`, BASE), '詳細URL').toEqual(byTicketId)
  })

  it('末尾スラッシュを許容する', () => {
    expect(parseTicketUrl(`${BASE}/t/DEV-12/`, BASE), '短縮URL').toEqual(byDisplayId)
    expect(parseTicketUrl(`${BASE}/tickets/${TICKET_ID}/`, BASE), '詳細URL').toEqual(byTicketId)
  })

  it('パーセントエンコードされていても解決できる', () => {
    expect(parseTicketUrl(`${BASE}/t/DEV%2D12`, BASE)).toEqual(byDisplayId)
  })

  it('別オリジンの同じパスは解決しない', () => {
    // 他サイトの /t/... を自分のチケットとして展開してはいけない
    expect(parseTicketUrl('https://evil.example.com/t/DEV-12', BASE), 'ホスト違い').toBeNull()
    expect(parseTicketUrl('http://devuntu.example.com/t/DEV-12', BASE), 'スキーム違い').toBeNull()
    expect(parseTicketUrl('https://devuntu.example.com.evil.jp/t/DEV-12', BASE), '後方一致の偽装').toBeNull()
    expect(parseTicketUrl(`https://evil.example.com/tickets/${TICKET_ID}`, BASE), '詳細URL').toBeNull()
  })

  it('チケットURL以外のパスは解決しない', () => {
    expect(parseTicketUrl(`${BASE}/boards/${TICKET_ID}`, BASE), 'ボード').toBeNull()
    expect(parseTicketUrl(`${BASE}/t`, BASE), '表示IDなし').toBeNull()
    expect(parseTicketUrl(`${BASE}/tickets`, BASE), 'チケット一覧').toBeNull()
    expect(parseTicketUrl(`${BASE}/t/DEV-12/extra`, BASE), '余分なセグメント').toBeNull()
    expect(parseTicketUrl(`${BASE}/tickets/${TICKET_ID}/extra`, BASE), '詳細URLの余分なセグメント').toBeNull()
  })

  it('表示IDの形式を満たさなければ解決しない', () => {
    expect(parseTicketUrl(`${BASE}/t/DEV`, BASE)).toBeNull()
    expect(parseTicketUrl(`${BASE}/t/TOOLONGKEY-12`, BASE)).toBeNull()
  })

  it('uuid v7 でなければ解決しない(任意の文字列で DB を引かない)', () => {
    expect(parseTicketUrl(`${BASE}/tickets/not-a-uuid`, BASE), 'uuid でない').toBeNull()
    expect(parseTicketUrl(`${BASE}/tickets/019fb795-5ac1-445c-91f0-c6aa35077d64`, BASE), 'v4 相当').toBeNull()
    expect(parseTicketUrl(`${BASE}/tickets/019fb795-5ac1-745c-91f0-c6aa35077d6`, BASE), '桁不足').toBeNull()
  })

  it('URL として読めない文字列は例外にせず null', () => {
    expect(() => parseTicketUrl('not a url', BASE)).not.toThrow()
    expect(parseTicketUrl('not a url', BASE), '不正な URL').toBeNull()
    expect(parseTicketUrl(`${BASE}/t/DEV-12`, ''), 'ベースURL未設定').toBeNull()
    expect(parseTicketUrl(`${BASE}/t/%E3%81%82%ZZ`, BASE), '壊れたエスケープ').toBeNull()
  })

  it('コメントのアンカーを付けてもチケットとして解決できる(通知のリンク)', () => {
    const url = `${BASE}${ticketShortPath('DEV-12')}#${commentAnchorId(TICKET_ID)}`
    expect(commentAnchorId(TICKET_ID), '画面側の要素 id と同じ形').toBe(`comment-${TICKET_ID}`)
    expect(parseTicketUrl(url, BASE)).toEqual(byDisplayId)
  })
})

describe('parseTicketNumber: 番号だけの指定', () => {
  it('# 付き / 無しのどちらも受ける', () => {
    expect(parseTicketNumber('12')).toBe(12)
    expect(parseTicketNumber('#12')).toBe(12)
  })

  it('数字以外が混じれば null', () => {
    expect(parseTicketNumber('12a')).toBeNull()
    expect(parseTicketNumber('##12')).toBeNull()
    expect(parseTicketNumber('')).toBeNull()
  })
})

describe('nextSequentialKey: 連番キーの採番', () => {
  it('既存が無ければ 1 から始める', () => {
    expect(nextSequentialKey('PRV', [])).toBe('PRV1')
  })

  it('既存の最大 + 1 を返す(件数ではなく最大値で決める)', () => {
    expect(nextSequentialKey('PRV', ['PRV1', 'PRV9', 'PRV3'])).toBe('PRV10')
  })

  it('接頭辞が違うキー / 連番でないキーは無視する', () => {
    expect(nextSequentialKey('PRV', ['DEV1', 'PRVX', 'PRV2'])).toBe('PRV3')
  })

  it('上限ちょうど(MAX_BOARD_KEY)までは採番する', () => {
    expect(nextSequentialKey('PRV', ['PRV9998'])).toBe('PRV9999')
    expect(nextSequentialKey('PRV', ['PRV9999'])).toBe('PRV10000')
  })

  it('上限を超える桁になったら null(表示IDを解決できないキーは作らせない)', () => {
    expect(nextSequentialKey('PRV', ['PRV99999'])).toBeNull()
    expect(nextSequentialKey('PRV', ['PRV1'], 3), 'maxLength は指定できる').toBeNull()
  })
})

describe('isReservedBoardKey: プライベート採番領域の予約', () => {
  it('PRV で始まるキーは予約済み', () => {
    expect(isReservedBoardKey('PRV1')).toBe(true)
    // これを通すと nextSequentialKey が採番不能になり ensurePrivateBoard が恒久的に失敗する
    expect(isReservedBoardKey('PRV99999')).toBe(true)
    expect(isReservedBoardKey('PRVX')).toBe(true)
  })

  it('小文字で入力されても予約済みと判定する', () => {
    expect(isReservedBoardKey('prv1')).toBe(true)
  })

  it('接頭辞が一致しないキーは予約対象外', () => {
    expect(isReservedBoardKey('DEV')).toBe(false)
    expect(isReservedBoardKey('PR')).toBe(false)
    expect(isReservedBoardKey('APRV1'), '途中に含むだけなら対象外').toBe(false)
  })
})

/* -------------------------------------------------------------------------------------------------
 * 検索
 * -----------------------------------------------------------------------------------------------*/

describe('splitKeywords: キーワードの分解', () => {
  it('空白区切りで分解する', () => {
    expect(splitKeywords('foo bar')).toEqual(['foo', 'bar'])
  })

  it('LIKE のワイルドカード(% _ \\)を除去する', () => {
    expect(splitKeywords('fo%o b_ar\\baz'), 'ワイルドカードは区切りとして扱われる').toEqual([
      'fo',
      'o',
      'b',
      'ar',
      'baz',
    ])
  })

  it('連続空白・前後の空白を無視する', () => {
    expect(splitKeywords('  foo   bar  ')).toEqual(['foo', 'bar'])
  })

  it('全角空白も区切りとして扱う', () => {
    expect(splitKeywords('検索　条件')).toEqual(['検索', '条件'])
  })

  it('上限を超えた語は切り捨てる(既定 5 語)', () => {
    expect(splitKeywords('a b c d e f g')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('空文字は 0 件', () => {
    expect(splitKeywords('')).toEqual([])
    expect(splitKeywords('   ')).toEqual([])
  })
})

describe('ticketScopeWhere: 可視スコープの where 断片', () => {
  it('可視ボードの in 条件になる(プライベートボードも含まれる)', () => {
    expect(ticketScopeWhere(['b1', 'b2'])).toEqual({ boardId: { in: ['b1', 'b2'] } })
  })

  it('可視ボードが無ければ 0 件になる', () => {
    // 旧実装は boardId=null の OR があったため空でも自分のチケットが見えたが、
    // 現在はプライベートボードが accessibleBoardIds に含まれていることが前提
    expect(ticketScopeWhere([]), 'ensurePrivateBoard を先に通していないと 0 件になる').toEqual({
      boardId: { in: [] },
    })
  })
})

describe('buildTicketWhere: 検索条件から Prisma where を組む', () => {
  const emptyParams: TicketSearchParams = {
    keyword: '',
    status: [],
    priority: [],
    tags: [],
    boardId: null,
    assignee: null,
  }
  const ctx = { accessibleBoardIds: ['b1', 'b2'] }

  it('条件なしなら可視スコープのみ', () => {
    const res = buildTicketWhere(emptyParams, ctx)
    expect(res.AND, '可視スコープの 1 条件だけになる').toHaveLength(1)
    expect((res.AND as object[])[0]).toEqual(ticketScopeWhere(['b1', 'b2']))
  })

  it('boardId 未指定なら可視ボード全体に限定する', () => {
    const res = buildTicketWhere(emptyParams, ctx)
    expect((res.AND as object[])[0]).toEqual({ boardId: { in: ['b1', 'b2'] } })
  })

  it('boardId 指定は可視ボードとの交差を取る', () => {
    const res = buildTicketWhere({ ...emptyParams, boardId: 'b1' }, ctx)
    expect((res.AND as object[])[0]).toEqual({ boardId: { in: ['b1'] } })
  })

  it('可視外の boardId を指定しても他ボードは見えない(0 件になる)', () => {
    const res = buildTicketWhere({ ...emptyParams, boardId: 'other' }, ctx)
    expect((res.AND as object[])[0], '交差が空になるため 0 件').toEqual({ boardId: { in: [] } })
  })

  it('キーワードは語ごとに AND 条件が増える', () => {
    const one = buildTicketWhere({ ...emptyParams, keyword: 'foo' }, ctx)
    const two = buildTicketWhere({ ...emptyParams, keyword: 'foo bar' }, ctx)
    expect(one.AND, 'スコープ + 1 語').toHaveLength(2)
    expect(two.AND, 'スコープ + 2 語').toHaveLength(3)
  })

  it('1 語はタイトル / 本文 / タグ / コメントを横断 OR する', () => {
    const res = buildTicketWhere({ ...emptyParams, keyword: 'foo' }, ctx)
    expect((res.AND as { OR?: unknown[] }[])[1]).toEqual({
      OR: [
        { title: { contains: 'foo', mode: 'insensitive' } },
        { content: { contains: 'foo', mode: 'insensitive' } },
        { tags: { some: { tag: { name: { equals: 'foo', mode: 'insensitive' } } } } },
        { comments: { some: { content: { contains: 'foo', mode: 'insensitive' } } } },
      ],
    })
  })

  it('表示IDを貼るとキー + 番号の完全一致が OR の先頭に足される', () => {
    const res = buildTicketWhere({ ...emptyParams, keyword: 'DEV-12' }, ctx)
    const or = (res.AND as { OR: unknown[] }[])[1].OR
    expect(or[0], '索引が効く完全一致を先に評価させる').toEqual({ number: 12, board: { key: 'DEV' } })
    expect(or, '文字列としての横断検索も残る').toHaveLength(5)
  })

  it('番号だけの指定はボードを跨いで番号一致する', () => {
    const res = buildTicketWhere({ ...emptyParams, keyword: '#12' }, ctx)
    expect((res.AND as { OR: unknown[] }[])[1].OR[0]).toEqual({ number: 12 })
  })

  it('status / priority / タグはいずれも in(= OR)になる', () => {
    const res = buildTicketWhere(
      { ...emptyParams, status: ['todo', 'doing'], priority: ['high'], tags: ['bug', 'ui'] },
      ctx,
    )
    const and = res.AND as object[]
    expect(and).toContainEqual({ status: { in: ['todo', 'doing'] } })
    expect(and).toContainEqual({ priority: { in: ['high'] } })
    // 退行防止: タグは 1 つの some に name: { in: [...] } でまとめること。
    // 名前ごとに some を分けて AND すると「すべてのタグを持つ」条件になってしまう
    expect(and, 'いずれかのタグを持てばヒットする EXISTS 条件').toContainEqual(tagNamesWhere(['bug', 'ui']))
    expect(and, 'スコープ + status + priority + タグ 1 条件').toHaveLength(4)
  })

  it('同名タグの重複指定は 1 件に畳まれる', () => {
    const res = buildTicketWhere({ ...emptyParams, tags: ['bug', 'bug', ' bug '] }, ctx)
    expect(res.AND, 'スコープ + タグ 1 条件').toHaveLength(2)
    expect((res.AND as object[])[1]).toEqual(tagNamesWhere(['bug']))
  })

  it('tags が空ならタグ条件を付けない', () => {
    const res = buildTicketWhere({ ...emptyParams, tags: [] }, ctx)
    expect(res.AND).toHaveLength(1)
  })

  it('assignee は userId 指定、ASSIGNEE_NONE は未割り当てに絞る', () => {
    expect(buildTicketWhere({ ...emptyParams, assignee: 'u1' }, ctx).AND as object[]).toContainEqual({
      assigneeId: 'u1',
    })
    expect(buildTicketWhere({ ...emptyParams, assignee: ASSIGNEE_NONE }, ctx).AND as object[]).toContainEqual({
      assigneeId: null,
    })
  })

  it('assignee 未指定(すべて)では担当者の条件を付けない', () => {
    expect(buildTicketWhere(emptyParams, ctx).AND).toHaveLength(1)
    expect(buildTicketWhere({ ...emptyParams, assignee: undefined }, ctx).AND).toHaveLength(1)
  })
})

describe('ticketListOrderBy: 一覧の並び順から Prisma orderBy を組む', () => {
  it('ascending / descending を asc / desc に変換する', () => {
    expect(ticketListOrderBy('title', 'ascending')).toEqual([{ title: 'asc' }, { id: 'asc' }])
    expect(ticketListOrderBy('title', 'descending')).toEqual([{ title: 'desc' }, { id: 'desc' }])
  })

  it('どの列でも最後のタイブレークに id が入る(ページ間で行が重複・欠落しないため)', () => {
    for (const column of TICKET_SORT_COLUMNS) {
      const orderBy = ticketListOrderBy(column, 'descending')
      expect(orderBy, `${column} は 2 条件になる`).toHaveLength(2)
      expect(orderBy[1], `${column} の末尾は id`).toEqual({ id: 'desc' })
    }
  })

  it('status / priority はスカラー列としてそのまま並べる(enum の宣言順で並ぶ)', () => {
    expect(ticketListOrderBy('status', 'ascending')[0]).toEqual({ status: 'asc' })
    expect(ticketListOrderBy('priority', 'ascending')[0]).toEqual({ priority: 'asc' })
  })

  it('assigneeName はリレーション先の name で並べる', () => {
    expect(ticketListOrderBy('assigneeName', 'ascending')[0]).toEqual({ assignee: { name: 'asc' } })
  })

  it('dueDate は昇順・降順とも未設定を末尾に寄せる', () => {
    expect(ticketListOrderBy('dueDate', 'ascending')[0]).toEqual({ dueDate: { sort: 'asc', nulls: 'last' } })
    expect(ticketListOrderBy('dueDate', 'descending')[0]).toEqual({ dueDate: { sort: 'desc', nulls: 'last' } })
  })
})

/* -------------------------------------------------------------------------------------------------
 * メンション
 * -----------------------------------------------------------------------------------------------*/

describe('stripCodeSpans / normalizeMentionText', () => {
  it('コードブロックとインラインコードを除去する', () => {
    expect(stripCodeSpans('a ```x``` b `y` c').includes('x')).toBe(false)
    expect(stripCodeSpans('a ```x``` b `y` c').includes('y')).toBe(false)
  })

  it('~~~ のフェンスも除去する', () => {
    expect(stripCodeSpans('a\n~~~\nx\n~~~\nb').includes('x')).toBe(false)
  })

  it('バッククォートを重ねたインラインコードも除去する', () => {
    expect(stripCodeSpans('a ``x`` b').includes('x')).toBe(false)
    expect(stripCodeSpans('a ``x`y`` b').includes('x')).toBe(false)
  })

  it('コード外のテキストは残す', () => {
    expect(stripCodeSpans('a `x` b ~~~\ny\n~~~ c')).toContain('a')
    expect(stripCodeSpans('a `x` b ~~~\ny\n~~~ c')).toContain('c')
  })

  it('全角・大文字小文字・前後空白を正規化する', () => {
    expect(normalizeMentionText(' ＴＡＲＯ ')).toBe('taro')
    expect(normalizeMentionText('Foo@Example.COM')).toBe('foo@example.com')
  })
})

describe('extractMentionEmails: 本文からメンションを抽出する', () => {
  /** 長さの境界を試すための、指定した長さちょうどのメールアドレス */
  const emailOfLength = (length: number) => `${'a'.repeat(length - '@ex.com'.length)}@ex.com`

  const cases: { label: string; input: string; expected: string[] }[] = [
    { label: '行頭のメンション', input: '@[taro@example.com]', expected: ['taro@example.com'] },
    { label: '文中のメンション', input: 'よろしく @[taro@example.com] です', expected: ['taro@example.com'] },
    {
      label: '連続したメンションを出現順に抽出する',
      input: '@[a@example.com]@[b@example.com]',
      expected: ['a@example.com', 'b@example.com'],
    },
    { label: '2 行目の行頭', input: '一行目\n@[taro@example.com]', expected: ['taro@example.com'] },
    { label: '読点が続いても終端できる', input: '@[taro@example.com]、次に', expected: ['taro@example.com'] },
    { label: '括弧で囲まれていてもよい', input: '(@[taro@example.com])', expected: ['taro@example.com'] },
    { label: '大文字は小文字に正規化する', input: '@[TARO@Example.COM]', expected: ['taro@example.com'] },
    {
      label: '重複は 1 件に畳む',
      input: '@[taro@example.com] と @[TARO@example.com]',
      expected: ['taro@example.com'],
    },
    {
      label: 'エスケープされた角括弧も拾う(エディタを通さず書かれた本文の保険)',
      input: '@\\[taro@example.com]',
      expected: ['taro@example.com'],
    },
    { label: '裸のメールアドレスは誤検知しない', input: 'foo@example.com へ連絡', expected: [] },
    { label: '直前が単語文字なら無視する', input: 'foo@[taro@example.com]', expected: [] },
    { label: '@ が連続する場合は無視する', input: '@@[taro@example.com]', expected: [] },
    { label: 'メールアドレスに見えない中身は拾わない', input: '@[太郎]', expected: [] },
    { label: 'ドメインにドットが無い中身は拾わない', input: '@[taro@example]', expected: [] },
    { label: 'コードブロック内は対象外', input: '```\n@[taro@example.com]\n```', expected: [] },
    { label: '~~~ のコードブロック内は対象外', input: '~~~\n@[taro@example.com]\n~~~', expected: [] },
    { label: 'インラインコード内は対象外', input: '`@[taro@example.com]`', expected: [] },
    { label: 'バッククォートを重ねたインラインコード内も対象外', input: '``@[taro@example.com]``', expected: [] },
    { label: '@ 単体は 0 件', input: '@', expected: [] },
    { label: '空文字は 0 件', input: '', expected: [] },
    {
      label: '最大長ちょうどは抽出する',
      input: `@[${emailOfLength(MENTION_EMAIL_MAX)}]`,
      expected: [emailOfLength(MENTION_EMAIL_MAX)],
    },
    { label: '最大長超過は抽出しない', input: `@[${emailOfLength(MENTION_EMAIL_MAX + 1)}]`, expected: [] },
  ]

  for (const { label, input, expected } of cases) {
    it(label, () => {
      expect(extractMentionEmails(input), `入力: ${JSON.stringify(input)}`).toEqual(expected)
    })
  }
})

describe('findMentions: 記法の位置も返す(表示用ノードへの差し替えに使う)', () => {
  it('記法全体の範囲を指す', () => {
    const text = 'よろしく @[taro@example.com] です'
    const [match] = findMentions(text)
    expect(text.slice(match.index, match.index + match.length)).toBe('@[taro@example.com]')
    expect(match.email).toBe('taro@example.com')
  })

  it('重複したメンションも畳まずすべて返す', () => {
    expect(findMentions('@[a@ex.com] @[a@ex.com]').length, '本文中の見た目はどちらも置き換える').toBe(2)
  })
})

describe('resolveMentionUserIds: メールアドレスを userId へ解決する', () => {
  const candidates = [
    { id: 'u1', email: 'taro@example.com' },
    { id: 'u2', email: 'hanako@example.com' },
  ]

  it('候補に一致すれば解決する', () => {
    expect(resolveMentionUserIds(['taro@example.com'], candidates)).toEqual(['u1'])
  })

  it('候補に無いメールアドレスは解決しない', () => {
    expect(resolveMentionUserIds(['jiro@example.com'], candidates)).toEqual([])
  })

  it('表示名が同じユーザーでもそれぞれ解決できる', () => {
    const sameName = [
      { id: 'u1', email: 'taro@example.com' },
      { id: 'u2', email: 'taro@other.com' },
    ]
    expect(resolveMentionUserIds(['taro@example.com', 'taro@other.com'], sameName)).toEqual(['u1', 'u2'])
  })

  it('大文字小文字の差異を吸収して一致する', () => {
    expect(resolveMentionUserIds(['TARO@Example.com'], candidates)).toEqual(['u1'])
  })

  it('候補が空なら 0 件', () => {
    expect(resolveMentionUserIds(['taro@example.com'], [])).toEqual([])
  })

  it('抽出順を保ち、同一 userId は 1 回だけ返す', () => {
    expect(resolveMentionUserIds(['hanako@example.com', 'taro@example.com', 'HANAKO@example.com'], candidates)).toEqual(
      ['u2', 'u1'],
    )
  })
})

/* -------------------------------------------------------------------------------------------------
 * メンションの入力補助
 * -----------------------------------------------------------------------------------------------*/

describe('matchMentionTrigger: キャレット直前の入力中メンションを捉える', () => {
  const cases: { label: string; input: string; expected: ReturnType<typeof matchMentionTrigger> }[] = [
    {
      label: '@ 単体でも一致する(直後に一覧を出すため)',
      input: '@',
      expected: { leadOffset: 0, matchingString: '', replaceableString: '@' },
    },
    {
      label: '行頭のクエリ',
      input: '@太',
      expected: { leadOffset: 0, matchingString: '太', replaceableString: '@太' },
    },
    {
      label: '空白の後のクエリ',
      input: 'よろしく @tar',
      expected: { leadOffset: 5, matchingString: 'tar', replaceableString: '@tar' },
    },
    {
      label: '空白なしの日本語文中でも一致する(@ の直前が単語文字でない)',
      input: '見て@やま',
      expected: { leadOffset: 2, matchingString: 'やま', replaceableString: '@やま' },
    },
    {
      label: '改行の後のクエリ',
      input: '一行目\n@太',
      expected: { leadOffset: 4, matchingString: '太', replaceableString: '@太' },
    },
    {
      label: 'メールアドレスの途中でも一致する(候補の絞り込みに使う)',
      input: '@taro.yamada@exa',
      expected: { leadOffset: 0, matchingString: 'taro.yamada@exa', replaceableString: '@taro.yamada@exa' },
    },
    {
      label: '句読点はクエリに含める(候補が無ければ一覧は出ない)',
      input: '@太郎。',
      expected: { leadOffset: 0, matchingString: '太郎。', replaceableString: '@太郎。' },
    },
    { label: '直前が単語文字ならメールアドレスとみなして一致しない', input: 'foo@exa', expected: null },
    { label: '@ が連続する場合は一致しない', input: '@@太', expected: null },
    { label: '空白でクエリが終端するので一致しない', input: '@太郎 ', expected: null },
    { label: '角括弧はクエリに使えない', input: '@[', expected: null },
    { label: 'メンションを含まない文字列', input: 'よろしく', expected: null },
    { label: '空文字', input: '', expected: null },
    {
      label: '最大長ちょうどのクエリは一致する',
      input: `@${'a'.repeat(MENTION_EMAIL_MAX)}`,
      expected: {
        leadOffset: 0,
        matchingString: 'a'.repeat(MENTION_EMAIL_MAX),
        replaceableString: `@${'a'.repeat(MENTION_EMAIL_MAX)}`,
      },
    },
    { label: '最大長を超えたクエリは一致しない', input: `@${'a'.repeat(MENTION_EMAIL_MAX + 1)}`, expected: null },
  ]

  for (const { label, input, expected } of cases) {
    it(label, () => {
      expect(matchMentionTrigger(input), `入力: ${JSON.stringify(input)}`).toEqual(expected)
    })
  }

  it('leadOffset は @ の位置を指す', () => {
    const input = 'よろしく @tar'
    const match = matchMentionTrigger(input)
    expect(input.slice(match?.leadOffset), 'leadOffset から末尾までが置換対象と一致する').toBe(match?.replaceableString)
  })
})

describe('formatMentionSource: 書き出した記法が extractMentionEmails で復元できる', () => {
  const emails = ['taro@example.com', 'taro.yamada+tag@example.co.jp', 'a@b.cd']

  for (const email of emails) {
    it(`往復する: ${email}`, () => {
      const source = formatMentionSource(email)
      expect(extractMentionEmails(source), `書き出し結果: ${source}`).toEqual([email])
    })
  }

  it('角括弧で囲み、大文字は小文字に揃える', () => {
    expect(formatMentionSource('TARO@Example.com')).toBe('@[taro@example.com]')
  })

  it('文中へ書き出しても復元できる', () => {
    const body = `よろしく ${formatMentionSource('taro@example.com')} お願いします`
    expect(extractMentionEmails(body)).toEqual(['taro@example.com'])
  })
})

describe('filterMentionCandidates: 入力中のクエリで候補を絞り込む', () => {
  const candidates = [
    { id: 'u1', name: 'hanako', email: 'hanako@example.com' },
    { id: 'u2', name: 'taro', email: 'taro@example.com' },
    { id: 'u3', name: 'yamada taro', email: 'yamada@example.com' },
    { id: 'u4', name: '山田 太郎', email: 'taro.yamada@example.com' },
  ]

  it('クエリが空なら全件返す', () => {
    expect(filterMentionCandidates(candidates, '').map((c) => c.id)).toEqual(['u1', 'u2', 'u3', 'u4'])
  })

  it('名前の前方一致・メールの前方一致・部分一致の順に寄せる', () => {
    expect(filterMentionCandidates(candidates, 'taro').map((c) => c.id)).toEqual(['u2', 'u4', 'u3'])
  })

  it('メールアドレスでも絞り込める', () => {
    expect(filterMentionCandidates(candidates, 'hanako@ex').map((c) => c.id)).toEqual(['u1'])
    expect(
      filterMentionCandidates(candidates, 'example.com').map((c) => c.id),
      '部分一致',
    ).toEqual(['u1', 'u2', 'u3', 'u4'])
  })

  it('全角・大文字小文字の差異を吸収する', () => {
    expect(filterMentionCandidates(candidates, 'ＴＡＲＯ').map((c) => c.id)).toEqual(['u2', 'u4', 'u3'])
    expect(filterMentionCandidates(candidates, '山田').map((c) => c.id)).toEqual(['u4'])
  })

  it('表示名が同じユーザーもどちらも候補に出す(メールアドレスで見分けられる)', () => {
    const sameName = [
      { id: 'u1', name: '山田 太郎', email: 'taro@example.com' },
      { id: 'u2', name: '山田 太郎', email: 'taro@other.com' },
    ]
    expect(filterMentionCandidates(sameName, '山田').map((c) => c.id)).toEqual(['u1', 'u2'])
  })

  it('一致しなければ 0 件', () => {
    expect(filterMentionCandidates(candidates, 'jiro')).toEqual([])
  })

  it('既定の上限で切る', () => {
    const many = Array.from({ length: MENTION_CANDIDATE_LIMIT + 5 }, (_, i) => ({
      id: `u${i}`,
      name: `user${i}`,
      email: `user${i}@example.com`,
    }))
    expect(filterMentionCandidates(many, '').length).toBe(MENTION_CANDIDATE_LIMIT)
    expect(filterMentionCandidates(many, '', 3).length).toBe(3)
  })

  it('渡した候補の余分な項目は保つ', () => {
    const withImage = [{ id: 'u1', name: 'taro', email: 'taro@example.com', image: 'https://example.com/a.png' }]
    expect(filterMentionCandidates(withImage, 'ta')[0].image).toBe('https://example.com/a.png')
  })
})

/* -------------------------------------------------------------------------------------------------
 * かんばんの並び替え
 * -----------------------------------------------------------------------------------------------*/

describe('parseDropTarget / laneDropId / cardDropId', () => {
  it('レーンの id をパースできる', () => {
    expect(parseDropTarget(laneDropId('doing'))).toEqual({ kind: 'lane', status: 'doing' })
  })

  it('カードの id をパースできる', () => {
    expect(parseDropTarget(cardDropId('t1'))).toEqual({ kind: 'card', ticketId: 't1' })
  })

  it('未知のステータス・形式は null', () => {
    expect(parseDropTarget('lane:unknown'), '存在しないステータス').toBeNull()
    expect(parseDropTarget('other:x'), '未知の種別').toBeNull()
    expect(parseDropTarget('lane:'), '値が空').toBeNull()
    expect(parseDropTarget('doing'), '区切りが無い').toBeNull()
  })
})

describe('nextOrder / reindexLane / insertAt', () => {
  it('空なら 0、既存があれば最大 + 1', () => {
    expect(nextOrder([])).toBe(0)
    expect(nextOrder([0, 1, 2])).toBe(3)
    expect(nextOrder([5, 1, 3]), '順不同でも最大値を見る').toBe(6)
  })

  it('欠番があっても最大値を基準にする', () => {
    expect(nextOrder([10]), '詰め直しはしない').toBe(11)
  })

  it('reindexLane は 0 始まりの連番へ再採番する', () => {
    expect(reindexLane(['a', 'b', 'c'])).toEqual([
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
      { id: 'c', order: 2 },
    ])
  })

  it('insertAt は指定位置へ挿入し、範囲外はクランプする', () => {
    expect(insertAt(['a', 'c'], 'b', 1)).toEqual(['a', 'b', 'c'])
    expect(insertAt(['a', 'b'], 'x', 0)).toEqual(['x', 'a', 'b'])
    expect(insertAt(['a', 'b'], 'x', 99), '上限はクランプ').toEqual(['a', 'b', 'x'])
    expect(insertAt(['a', 'b'], 'x', -5), '下限はクランプ').toEqual(['x', 'a', 'b'])
  })
})

describe('applyLaneMove: DnD 結果をレーンへ適用する', () => {
  const makeLanes = (init: Partial<Record<TicketStatus, string[]>>): LaneMap => {
    const lanes = {} as LaneMap
    for (const status of TICKET_STATUSES) {
      lanes[status] = (init[status] ?? []).map((id) => ({ id, status }))
    }
    return lanes
  }
  const ids = (cards: { id: string }[]) => cards.map((c) => c.id)

  it('レーン間の移動はドロップ先の末尾へ入る', () => {
    const lanes = makeLanes({ todo: ['t1', 't2'], doing: ['d1'] })
    const res = applyLaneMove(lanes, { ticketId: 't1', target: { kind: 'lane', status: 'doing' } })
    expect(res).not.toBeNull()
    expect(res?.from, '移動元のレーン').toBe('todo')
    expect(res?.status).toBe('doing')
    expect(res?.index, '末尾の位置').toBe(1)
    expect(ids(res!.lanes.doing)).toEqual(['d1', 't1'])
    expect(ids(res!.lanes.todo), '移動元から除かれる').toEqual(['t2'])
    expect(res!.lanes.doing[1].status, 'カードの status も更新される').toBe('doing')
  })

  it('元の LaneMap を破壊しない', () => {
    const lanes = makeLanes({ todo: ['t1'], doing: [] })
    applyLaneMove(lanes, { ticketId: 't1', target: { kind: 'lane', status: 'doing' } })
    expect(ids(lanes.todo), '引数はそのまま').toEqual(['t1'])
    expect(ids(lanes.doing)).toEqual([])
  })

  it('空レーンへ移動できる', () => {
    const lanes = makeLanes({ todo: ['t1'], backlog: [] })
    const res = applyLaneMove(lanes, { ticketId: 't1', target: { kind: 'lane', status: 'backlog' } })
    expect(res?.index).toBe(0)
    expect(ids(res!.lanes.backlog)).toEqual(['t1'])
  })

  it('backlog から todo へも移動できる', () => {
    const lanes = makeLanes({ backlog: ['b1'], todo: ['t1'] })
    const res = applyLaneMove(lanes, { ticketId: 'b1', target: { kind: 'lane', status: 'todo' } })
    expect(ids(res!.lanes.todo)).toEqual(['t1', 'b1'])
    expect(ids(res!.lanes.backlog)).toEqual([])
  })

  it('同一レーン内でカードの直前へ移動する(上へ)', () => {
    const lanes = makeLanes({ todo: ['a', 'b', 'c'] })
    const res = applyLaneMove(lanes, { ticketId: 'c', target: { kind: 'card', ticketId: 'a' } })
    expect(ids(res!.lanes.todo)).toEqual(['c', 'a', 'b'])
    expect(res?.index).toBe(0)
    expect(res?.from, '同一レーン内なら from と status は同じ').toBe(res?.status)
  })

  it('同一レーン内で下へ移動する', () => {
    const lanes = makeLanes({ todo: ['a', 'b', 'c'] })
    const res = applyLaneMove(lanes, { ticketId: 'a', target: { kind: 'card', ticketId: 'c' } })
    expect(ids(res!.lanes.todo)).toEqual(['b', 'a', 'c'])
  })

  it('同一レーン内でレーンへドロップすると末尾へ移動する', () => {
    const lanes = makeLanes({ todo: ['a', 'b', 'c'] })
    const res = applyLaneMove(lanes, { ticketId: 'a', target: { kind: 'lane', status: 'todo' } })
    expect(ids(res!.lanes.todo)).toEqual(['b', 'c', 'a'])
    expect(res?.index).toBe(2)
  })

  it('位置が変わらない移動は null(更新を投げない)', () => {
    const lanes = makeLanes({ todo: ['a', 'b', 'c'] })
    expect(
      applyLaneMove(lanes, { ticketId: 'a', target: { kind: 'card', ticketId: 'b' } }),
      '直後のカードへのドロップは同じ位置',
    ).toBeNull()
    expect(
      applyLaneMove(lanes, { ticketId: 'c', target: { kind: 'lane', status: 'todo' } }),
      '既に末尾のカードをレーンへドロップ',
    ).toBeNull()
  })

  it('自分自身へのドロップは null', () => {
    const lanes = makeLanes({ todo: ['a'] })
    expect(applyLaneMove(lanes, { ticketId: 'a', target: { kind: 'card', ticketId: 'a' } })).toBeNull()
  })

  it('存在しないチケットは null', () => {
    const lanes = makeLanes({ todo: ['a'] })
    expect(applyLaneMove(lanes, { ticketId: 'zzz', target: { kind: 'lane', status: 'doing' } })).toBeNull()
  })

  it('存在しないドロップ先カードは null', () => {
    const lanes = makeLanes({ todo: ['a'] })
    expect(applyLaneMove(lanes, { ticketId: 'a', target: { kind: 'card', ticketId: 'zzz' } })).toBeNull()
  })
})

describe('kanbanDoneSince / kanbanTicketWhere / kanbanLaneWhere: かんばんの表示対象', () => {
  const now = new Date('2026-08-10T12:00:00.000Z')
  const since = kanbanDoneSince(now)
  // 完了日時なし(この機能の導入前に完了したチケット)も表示し続ける
  const doneVisible = { OR: [{ completedAt: null }, { completedAt: { gte: since } }] }

  it('表示期限は現在から KANBAN_DONE_VISIBLE_DAYS 日前', () => {
    expect(since.toISOString()).toBe('2026-07-11T12:00:00.000Z')
    expect(kanbanDoneSince(now, 1).toISOString(), '日数は上書きできる').toBe('2026-08-09T12:00:00.000Z')
  })

  it('ボード単位の where 断片は「完了以外 / 表示対象の完了」の OR になる', () => {
    expect(kanbanTicketWhere('b1', since)).toEqual({
      boardId: 'b1',
      OR: [{ status: { not: 'done' } }, doneVisible],
    })
  })

  it('done レーンの where 断片は表示期限で絞る', () => {
    expect(kanbanLaneWhere('b1', 'done', since)).toEqual({ boardId: 'b1', status: 'done', ...doneVisible })
  })

  it('done 以外のレーンの where 断片はボード + ステータスのみ', () => {
    for (const status of TICKET_STATUSES.filter((s) => s !== 'done')) {
      expect(kanbanLaneWhere('b1', status, since), status).toEqual({ boardId: 'b1', status })
    }
  })
})

describe('emptyLaneMap / groupByLane: カードのレーン振り分け', () => {
  it('空配列は 4 レーンすべて空の LaneMap になる', () => {
    const lanes = groupByLane([])
    expect(Object.keys(lanes).sort()).toEqual([...TICKET_STATUSES].sort())
    for (const status of TICKET_STATUSES) {
      expect(lanes[status], status).toEqual([])
    }
  })

  it('status 別に振り分け、入力順(order 順)を保つ', () => {
    const cards = [
      { id: 't1', status: 'todo' as const },
      { id: 'd1', status: 'doing' as const },
      { id: 't2', status: 'todo' as const },
      { id: 'b1', status: 'backlog' as const },
    ]
    const lanes = groupByLane(cards)
    expect(
      lanes.todo.map((c) => c.id),
      '入力順を保持',
    ).toEqual(['t1', 't2'])
    expect(lanes.doing.map((c) => c.id)).toEqual(['d1'])
    expect(lanes.backlog.map((c) => c.id)).toEqual(['b1'])
    expect(lanes.done).toEqual([])
  })

  it('emptyLaneMap は呼び出しごとに独立した配列を返す', () => {
    const a = emptyLaneMap()
    const b = emptyLaneMap()
    a.todo.push({ id: 'x', status: 'todo' })
    expect(b.todo, '参照が共有されていない').toEqual([])
  })
})

/* -------------------------------------------------------------------------------------------------
 * かんばんの絞り込み
 * -----------------------------------------------------------------------------------------------*/

const makeCard = (id: string, over: Partial<KanbanFilterCard> = {}): KanbanFilterCard => ({
  id,
  status: 'todo',
  assigneeId: null,
  priority: 'medium',
  tags: [],
  dueDate: null,
  completedAt: null,
  ...over,
})

/** 期日は UTC 0:00 で保存されるので、テストの値もその形で作る */
const due = (value: string) => new Date(`${value}T00:00:00.000Z`)

/** 完了カードの表示期間の判定に使う基準時刻。完了日時は時刻まで保持する */
const filterNow = new Date('2026-08-10T12:00:00.000Z')

describe('isKanbanFilterActive: 絞り込みが指定されているか', () => {
  it('初期値は非アクティブ', () => {
    expect(isKanbanFilterActive(defaultKanbanFilter)).toBe(false)
  })

  it('いずれか 1 つでも指定があればアクティブ', () => {
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, assignee: 'u1' })).toBe(true)
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, assignee: 'none' })).toBe(true)
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, priority: ['high'] })).toBe(true)
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, tags: ['bug'] })).toBe(true)
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, due: { start: '2026-08-01', end: '2026-08-31' } })).toBe(true)
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, doneDays: 7 })).toBe(true)
  })

  it('完了の表示期間が取得上限と同じならアクティブにしない', () => {
    expect(isKanbanFilterActive({ ...defaultKanbanFilter, doneDays: KANBAN_DONE_VISIBLE_DAYS })).toBe(false)
  })
})

describe('KANBAN_DONE_DAYS_OPTIONS: 完了の表示期間の選択肢', () => {
  it('最大値は取得上限と一致する(サーバーがそれより古い done を返さない)', () => {
    expect(Math.max(...KANBAN_DONE_DAYS_OPTIONS)).toBe(KANBAN_DONE_VISIBLE_DAYS)
  })
})

describe('matchesKanbanFilter: カード 1 枚の一致判定', () => {
  it('条件なしはすべて通す', () => {
    expect(matchesKanbanFilter(makeCard('a', { assigneeId: 'u1' }), defaultKanbanFilter)).toBe(true)
  })

  it('担当者: 特定ユーザー', () => {
    const filter = { ...defaultKanbanFilter, assignee: 'u1' }
    expect(matchesKanbanFilter(makeCard('a', { assigneeId: 'u1' }), filter)).toBe(true)
    expect(matchesKanbanFilter(makeCard('b', { assigneeId: 'u2' }), filter)).toBe(false)
    expect(matchesKanbanFilter(makeCard('c', { assigneeId: null }), filter)).toBe(false)
  })

  it('担当者: 未割り当て(none)', () => {
    const filter = { ...defaultKanbanFilter, assignee: 'none' }
    expect(matchesKanbanFilter(makeCard('a', { assigneeId: null }), filter)).toBe(true)
    expect(matchesKanbanFilter(makeCard('b', { assigneeId: 'u1' }), filter)).toBe(false)
  })

  it('優先度: 空配列は無条件、非空は in 判定', () => {
    const card = makeCard('a', { priority: 'high' })
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, priority: [] })).toBe(true)
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, priority: ['urgent', 'high'] })).toBe(true)
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, priority: ['low'] })).toBe(false)
  })

  it('タグ: いずれか 1 つでも持てばヒット(OR)', () => {
    const card = makeCard('a', { tags: [{ name: 'bug' }, { name: 'ui' }] })
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, tags: ['ui'] })).toBe(true)
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, tags: ['ops', 'bug'] })).toBe(true)
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, tags: ['ops'] })).toBe(false)
    expect(matchesKanbanFilter(makeCard('b'), { ...defaultKanbanFilter, tags: ['bug'] })).toBe(false)
  })

  it('期日: 範囲内は両端を含む', () => {
    const filter = { ...defaultKanbanFilter, due: { start: '2026-08-10', end: '2026-08-20' } }
    expect(matchesKanbanFilter(makeCard('a', { dueDate: due('2026-08-15') }), filter)).toBe(true)
    expect(matchesKanbanFilter(makeCard('s', { dueDate: due('2026-08-10') }), filter), '開始と同日').toBe(true)
    expect(matchesKanbanFilter(makeCard('e', { dueDate: due('2026-08-20') }), filter), '終了と同日').toBe(true)
  })

  it('期日: 範囲外は落とす', () => {
    const filter = { ...defaultKanbanFilter, due: { start: '2026-08-10', end: '2026-08-20' } }
    expect(matchesKanbanFilter(makeCard('a', { dueDate: due('2026-08-09') }), filter)).toBe(false)
    expect(matchesKanbanFilter(makeCard('b', { dueDate: due('2026-08-21') }), filter)).toBe(false)
    // 年をまたいでも辞書順比較が崩れないこと
    expect(matchesKanbanFilter(makeCard('c', { dueDate: due('2025-12-31') }), filter)).toBe(false)
  })

  it('期日: 未設定はどの範囲にも入らない', () => {
    const filter = { ...defaultKanbanFilter, due: { start: '2026-08-10', end: '2026-08-20' } }
    expect(matchesKanbanFilter(makeCard('a', { dueDate: null }), filter)).toBe(false)
    // 範囲が未指定なら期日なしも通す
    expect(matchesKanbanFilter(makeCard('a', { dueDate: null }), defaultKanbanFilter)).toBe(true)
  })

  it('複数条件は AND', () => {
    const filter = {
      ...defaultKanbanFilter,
      assignee: 'u1',
      priority: ['high' as const],
      tags: ['bug'],
      due: { start: '2026-08-10', end: '2026-08-20' },
    }
    const base = { assigneeId: 'u1', priority: 'high' as const, tags: [{ name: 'bug' }], dueDate: due('2026-08-15') }
    expect(matchesKanbanFilter(makeCard('a', base), filter)).toBe(true)
    expect(matchesKanbanFilter(makeCard('b', { ...base, priority: 'low' }), filter)).toBe(false)
    expect(matchesKanbanFilter(makeCard('c', { ...base, dueDate: due('2026-09-01') }), filter)).toBe(false)
  })

  it('完了の表示期間: 期間内の完了は残り、期間外は落ちる', () => {
    const filter = { ...defaultKanbanFilter, doneDays: 7 }
    const done = (completedAt: Date) => makeCard('a', { status: 'done' as const, completedAt })
    expect(matchesKanbanFilter(done(new Date('2026-08-10T00:00:00.000Z')), filter, filterNow)).toBe(true)
    expect(matchesKanbanFilter(done(new Date('2026-08-03T12:00:00.000Z')), filter, filterNow), '境界と同時刻').toBe(
      true,
    )
    expect(matchesKanbanFilter(done(new Date('2026-08-03T11:59:59.000Z')), filter, filterNow)).toBe(false)
  })

  it('完了の表示期間: 完了日時なしの done は常に残す(サーバーの表示条件と揃える)', () => {
    const card = makeCard('a', { status: 'done', completedAt: null })
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, doneDays: 1 }, filterNow)).toBe(true)
  })

  it('完了の表示期間: done 以外は完了日時が古くても落ちない', () => {
    const card = makeCard('a', { status: 'todo', completedAt: new Date('2026-01-01T00:00:00.000Z') })
    expect(matchesKanbanFilter(card, { ...defaultKanbanFilter, doneDays: 1 }, filterNow)).toBe(true)
  })
})

describe('filterLaneMap / countLaneMap: レーン単位の絞り込み', () => {
  const lanes = groupByLane([
    makeCard('t1', { status: 'todo', assigneeId: 'u1', priority: 'high', dueDate: due('2026-08-15') }),
    makeCard('t2', { status: 'todo', assigneeId: 'u2', priority: 'low', dueDate: due('2026-09-01') }),
    makeCard('d1', {
      status: 'doing',
      assigneeId: 'u1',
      priority: 'low',
      tags: [{ name: 'bug' }],
      dueDate: due('2026-08-20'),
    }),
    makeCard('b1', { status: 'backlog' }),
  ])

  it('条件なしは同一参照を返す(useMemo の無駄な再生成を避ける)', () => {
    expect(filterLaneMap(lanes, defaultKanbanFilter)).toBe(lanes)
  })

  it('レーンをまたいで絞り込まれ、4 レーンすべてが揃う', () => {
    const filtered = filterLaneMap(lanes, { ...defaultKanbanFilter, assignee: 'u1' })
    expect(Object.keys(filtered).sort()).toEqual([...TICKET_STATUSES].sort())
    expect(filtered.todo.map((c) => c.id)).toEqual(['t1'])
    expect(filtered.doing.map((c) => c.id)).toEqual(['d1'])
    expect(filtered.backlog).toEqual([])
    expect(countLaneMap(filtered)).toBe(2)
  })

  it('元の LaneMap は変更されない', () => {
    filterLaneMap(lanes, { ...defaultKanbanFilter, tags: ['bug'] })
    expect(countLaneMap(lanes)).toBe(4)
  })

  it('期日の範囲で絞ると、範囲外と期日なしが落ちる', () => {
    const filtered = filterLaneMap(lanes, { ...defaultKanbanFilter, due: { start: '2026-08-01', end: '2026-08-31' } })
    expect(filtered.todo.map((c) => c.id)).toEqual(['t1'])
    expect(filtered.doing.map((c) => c.id)).toEqual(['d1'])
    expect(filtered.backlog, '期日なしは除外').toEqual([])
    expect(countLaneMap(filtered)).toBe(2)
  })

  it('一致なしは全レーン空', () => {
    const filtered = filterLaneMap(lanes, { ...defaultKanbanFilter, tags: ['nope'] })
    expect(countLaneMap(filtered)).toBe(0)
  })

  it('完了の表示期間は done レーンだけを絞る', () => {
    const withDone = groupByLane([
      makeCard('t1', { status: 'todo' }),
      makeCard('recent', { status: 'done', completedAt: new Date('2026-08-09T00:00:00.000Z') }),
      makeCard('old', { status: 'done', completedAt: new Date('2026-07-20T00:00:00.000Z') }),
    ])
    const filtered = filterLaneMap(withDone, { ...defaultKanbanFilter, doneDays: 7 }, filterNow)
    expect(filtered.done.map((c) => c.id)).toEqual(['recent'])
    expect(
      filtered.todo.map((c) => c.id),
      '他のレーンは変わらない',
    ).toEqual(['t1'])
  })
})
