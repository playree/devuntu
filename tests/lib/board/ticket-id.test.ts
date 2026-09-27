/**
 * チケットの表示ID・URL・ボードキー採番(`board/ticket-id.ts`)の単体テスト
 *
 * prisma を型のみ参照する純粋関数なので、DB を起動せずに検証できる。
 */

import {
  commentAnchorId,
  isReservedBoardKey,
  nextSequentialKey,
  parseTicketDisplayId,
  parseTicketNumber,
  parseTicketUrl,
  ticketDisplayId,
  ticketShortPath,
} from '@/lib/board/ticket-id'
import { describe, expect, it } from 'vitest'

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
