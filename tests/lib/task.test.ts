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
  cardDropId,
  countLaneMap,
  defaultKanbanFilter,
  emptyLaneMap,
  evaluateTicketAccess,
  extractMentionNames,
  filterLaneMap,
  filterMentionCandidates,
  formatMentionText,
  groupByLane,
  insertAt,
  isKanbanFilterActive,
  isMentionableName,
  isReservedBoardKey,
  kanbanDoneSince,
  kanbanLaneWhere,
  kanbanTicketWhere,
  laneDropId,
  matchesKanbanFilter,
  matchMentionTrigger,
  MENTION_CANDIDATE_LIMIT,
  MENTION_NAME_MAX,
  nextOrder,
  nextSequentialKey,
  normalizeMentionName,
  parseDropTarget,
  parseTicketDisplayId,
  parseTicketNumber,
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
  type BoardRole,
  type KanbanFilterCard,
  type LaneMap,
  type TicketSearchParams,
} from '@/lib/task'
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
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u9', boardRole: 'owner', archived: false })
    expect(res).toEqual({ canView: true, canEdit: true, canDelete: true })
  })

  it('プライベートボード相当(自分が owner かつ作成者)は全操作可', () => {
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u1', boardRole: 'owner', archived: false })
    expect(res, 'プライベートチケットの従来挙動と一致する').toEqual({
      canView: true,
      canEdit: true,
      canDelete: true,
    })
  })

  it('member かつ作成者なら削除可能', () => {
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u1', boardRole: 'member', archived: false })
    expect(res.canDelete, '自分が作成したチケットは削除できる').toBe(true)
  })

  it('member かつ非作成者は削除不可(閲覧・編集は可能)', () => {
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u9', boardRole: 'member', archived: false })
    expect(res).toEqual({ canView: true, canEdit: true, canDelete: false })
  })

  it('非メンバー(boardRole=null)は作成者でも一切不可', () => {
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u1', boardRole: null, archived: false })
    expect(res).toEqual({ canView: false, canEdit: false, canDelete: false })
  })

  it('アーカイブ済みボードは owner でも読み取り専用', () => {
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u1', boardRole: 'owner', archived: true })
    expect(res, 'アーカイブ解除はボード設定側の権限なのでチケットは書けない').toEqual({
      canView: true,
      canEdit: false,
      canDelete: false,
    })
  })

  it('アーカイブ済みボードは member でも書き込み不可', () => {
    const res = evaluateTicketAccess({ userId: 'u1', createdById: 'u1', boardRole: 'member', archived: true })
    expect(res).toEqual({ canView: true, canEdit: false, canDelete: false })
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

describe('stripCodeSpans / normalizeMentionName', () => {
  it('コードブロックとインラインコードを除去する', () => {
    expect(stripCodeSpans('a ```x``` b `y` c').includes('x')).toBe(false)
    expect(stripCodeSpans('a ```x``` b `y` c').includes('y')).toBe(false)
  })

  it('全角・大文字小文字・前後空白を正規化する', () => {
    expect(normalizeMentionName(' ＴＡＲＯ ')).toBe('taro')
    expect(normalizeMentionName('Taro')).toBe('taro')
  })
})

describe('extractMentionNames: 本文からメンションを抽出する', () => {
  const cases: { label: string; input: string; expected: string[] }[] = [
    { label: '行頭のメンション', input: '@太郎', expected: ['太郎'] },
    { label: '文中のメンション', input: 'よろしく @太郎 です', expected: ['太郎'] },
    { label: '連続したメンションを出現順に抽出する', input: '@alice @bob', expected: ['alice', 'bob'] },
    { label: '2 行目の行頭', input: '一行目\n@太郎', expected: ['太郎'] },
    { label: '角括弧で空白入りの名前を指定できる', input: '@[山田 太郎] お願いします', expected: ['山田 太郎'] },
    { label: '読点で終端する', input: '@太郎、次に', expected: ['太郎'] },
    { label: '句点で終端する', input: '@太郎。', expected: ['太郎'] },
    { label: '閉じ括弧で終端する', input: '(@太郎)', expected: ['太郎'] },
    { label: 'ピリオドで終端する', input: 'thanks @taro.', expected: ['taro'] },
    { label: '重複は 1 件に畳む', input: '@太郎 と @太郎', expected: ['太郎'] },
    { label: '大文字小文字の差異も重複扱い', input: '@Taro @taro', expected: ['Taro'] },
    { label: 'メールアドレスは誤検知しない', input: 'foo@example.com へ連絡', expected: [] },
    { label: '@ が連続する場合は無視する', input: '@@太郎', expected: [] },
    { label: 'コードブロック内は対象外', input: '```\n@太郎\n```', expected: [] },
    { label: 'インラインコード内は対象外', input: '`@太郎`', expected: [] },
    { label: '@ 単体は 0 件', input: '@', expected: [] },
    { label: '空文字は 0 件', input: '', expected: [] },
    { label: '最大長(60文字)は抽出する', input: `@${'a'.repeat(60)}`, expected: ['a'.repeat(60)] },
    { label: '最大長超過(61文字)は抽出しない', input: `@${'a'.repeat(61)}`, expected: [] },
  ]

  for (const { label, input, expected } of cases) {
    it(label, () => {
      expect(extractMentionNames(input), `入力: ${JSON.stringify(input)}`).toEqual(expected)
    })
  }
})

describe('resolveMentionUserIds: 表示名を userId へ解決する', () => {
  const candidates = [
    { id: 'u1', name: 'taro' },
    { id: 'u2', name: 'hanako' },
  ]

  it('候補に一致すれば解決する', () => {
    expect(resolveMentionUserIds(['taro'], candidates)).toEqual(['u1'])
  })

  it('候補に無い名前は解決しない', () => {
    expect(resolveMentionUserIds(['jiro'], candidates)).toEqual([])
  })

  it('同名の候補が 2 人いる場合は誤通知を避けるため解決しない', () => {
    const dup = [
      { id: 'u1', name: 'taro' },
      { id: 'u3', name: 'taro' },
    ]
    expect(resolveMentionUserIds(['taro'], dup), '曖昧なメンションは通知しない').toEqual([])
  })

  it('全角・大文字小文字の差異を吸収して一致する', () => {
    expect(resolveMentionUserIds(['ＴＡＲＯ'], candidates)).toEqual(['u1'])
    expect(resolveMentionUserIds(['Taro'], candidates)).toEqual(['u1'])
  })

  it('候補が空なら 0 件', () => {
    expect(resolveMentionUserIds(['taro'], [])).toEqual([])
  })

  it('抽出順を保ち、同一 userId は 1 回だけ返す', () => {
    expect(resolveMentionUserIds(['hanako', 'taro', 'ＨＡＮＡＫＯ'], candidates)).toEqual(['u2', 'u1'])
  })

  it('同じ ID が候補に重複していても解決できる', () => {
    const dupRow = [
      { id: 'u1', name: 'taro' },
      { id: 'u1', name: 'taro' },
    ]
    expect(resolveMentionUserIds(['taro'], dupRow), '同一 ID の重複は同名衝突ではない').toEqual(['u1'])
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
    { label: '直前が単語文字ならメールアドレスとみなして一致しない', input: 'foo@exa', expected: null },
    { label: '@ が連続する場合は一致しない', input: '@@太', expected: null },
    { label: '区切り文字でクエリが終端するので一致しない', input: '@太郎 ', expected: null },
    { label: '句点の後は一致しない', input: '@太郎。', expected: null },
    { label: 'メンションを含まない文字列', input: 'よろしく', expected: null },
    { label: '空文字', input: '', expected: null },
    {
      label: '最大長ちょうどのクエリは一致する',
      input: `@${'a'.repeat(MENTION_NAME_MAX)}`,
      expected: {
        leadOffset: 0,
        matchingString: 'a'.repeat(MENTION_NAME_MAX),
        replaceableString: `@${'a'.repeat(MENTION_NAME_MAX)}`,
      },
    },
    { label: '最大長を超えたクエリは一致しない', input: `@${'a'.repeat(MENTION_NAME_MAX + 1)}`, expected: null },
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

describe('isMentionableName: メンション記法で書ける表示名か', () => {
  it('通常の名前は書ける', () => {
    expect(isMentionableName('taro')).toBe(true)
    expect(isMentionableName('山田 太郎'), '空白入りは角括弧で囲めるので書ける').toBe(true)
  })

  it('空・空白のみは書けない', () => {
    expect(isMentionableName('')).toBe(false)
    expect(isMentionableName('   ')).toBe(false)
  })

  it('角括弧の閉じ・改行を含む名前は書けない', () => {
    expect(isMentionableName('a]b'), '@[..] の内側に置けない').toBe(false)
    expect(isMentionableName('a\nb')).toBe(false)
  })

  it('最大長を超える名前は書けない', () => {
    expect(isMentionableName('a'.repeat(MENTION_NAME_MAX))).toBe(true)
    expect(isMentionableName('a'.repeat(MENTION_NAME_MAX + 1))).toBe(false)
  })
})

describe('formatMentionText: 挿入した文字列が extractMentionNames で復元できる', () => {
  const names = [
    'taro',
    '太郎',
    '山田 太郎',
    'Yamada Taro',
    'a.b',
    'taro(sales)',
    'ＴＡＲＯ',
    'a'.repeat(MENTION_NAME_MAX),
  ]

  for (const name of names) {
    it(`往復する: ${JSON.stringify(name)}`, () => {
      const inserted = formatMentionText(name)
      expect(extractMentionNames(inserted), `挿入結果: ${JSON.stringify(inserted)}`).toEqual([name])
    })
  }

  it('区切り文字を含まない名前は角括弧で囲まない', () => {
    expect(formatMentionText('taro')).toBe('@taro ')
  })

  it('空白や記号を含む名前は角括弧で囲む', () => {
    expect(formatMentionText('山田 太郎')).toBe('@[山田 太郎] ')
    expect(formatMentionText('a.b')).toBe('@[a.b] ')
  })

  it('前後の空白は落とす', () => {
    expect(formatMentionText('  taro  ')).toBe('@taro ')
  })

  it('文中へ挿入しても復元できる', () => {
    const body = `よろしく ${formatMentionText('山田 太郎')}お願いします`
    expect(extractMentionNames(body)).toEqual(['山田 太郎'])
  })
})

describe('filterMentionCandidates: 入力中のクエリで候補を絞り込む', () => {
  const candidates = [
    { id: 'u1', name: 'hanako' },
    { id: 'u2', name: 'taro' },
    { id: 'u3', name: 'yamada taro' },
    { id: 'u4', name: '山田 太郎' },
  ]

  it('クエリが空なら全件返す', () => {
    expect(filterMentionCandidates(candidates, '').map((c) => c.id)).toEqual(['u1', 'u2', 'u3', 'u4'])
  })

  it('前方一致を部分一致より先に寄せる', () => {
    expect(
      filterMentionCandidates(candidates, 'taro').map((c) => c.id),
      'taro が yamada taro より先',
    ).toEqual(['u2', 'u3'])
  })

  it('全角・大文字小文字の差異を吸収する', () => {
    expect(filterMentionCandidates(candidates, 'ＴＡＲＯ').map((c) => c.id)).toEqual(['u2', 'u3'])
    expect(filterMentionCandidates(candidates, '山田').map((c) => c.id)).toEqual(['u4'])
  })

  it('一致しなければ 0 件', () => {
    expect(filterMentionCandidates(candidates, 'jiro')).toEqual([])
  })

  it('記法に載せられない名前は候補に出さない', () => {
    const invalid = [
      { id: 'u1', name: '' },
      { id: 'u2', name: 'a]b' },
      { id: 'u3', name: 'a'.repeat(MENTION_NAME_MAX + 1) },
    ]
    expect(filterMentionCandidates(invalid, ''), '選んでも解決されない候補は出さない').toEqual([])
  })

  it('既定の上限で切る', () => {
    const many = Array.from({ length: MENTION_CANDIDATE_LIMIT + 5 }, (_, i) => ({ id: `u${i}`, name: `user${i}` }))
    expect(filterMentionCandidates(many, '').length).toBe(MENTION_CANDIDATE_LIMIT)
    expect(filterMentionCandidates(many, '', 3).length).toBe(3)
  })

  it('渡した候補の余分な項目は保つ', () => {
    const withImage = [{ id: 'u1', name: 'taro', image: 'https://example.com/a.png' }]
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
  ...over,
})

/** 期日は UTC 0:00 で保存されるので、テストの値もその形で作る */
const due = (value: string) => new Date(`${value}T00:00:00.000Z`)

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
})
