/**
 * ボードキーとチケットの表示ID・URL の組み立てと解析
 *
 * サーバー / クライアントの双方から import する純粋関数のみを置く。
 */

/**
 * プライベートボードの Board.name に入れる固定値。
 * 表示は kind==='private' のときロケール(`private`)へ差し替えるため、この値は画面に出ない。
 */
export const PRIVATE_BOARD_NAME = '__private__'

/** ボードキーの最大長。BOARD_KEY_PATTERN と一致させる */
export const MAX_BOARD_KEY = 8

/**
 * ボードキー(表示IDの接頭辞)の形式。大文字英字始まりの大文字英数 2〜8 字。
 * 検索語の判定(parseTicketDisplayId)でも同じ形を使うため、変える場合は両方を揃えること。
 */
export const BOARD_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/

/** ボードキーの重複(DB の @unique 違反)。画面側で分岐するため 'use client' の付かないここに置く */
export const DUPLICATED_BOARD_KEY = 'DUPLICATED_BOARD_KEY'

/** プライベートボードのキーの接頭辞。利用者は入力せず PRV<連番> で自動採番する */
export const PRIVATE_BOARD_KEY_PREFIX = 'PRV'

/**
 * システムが予約しているキーか。チームボードのキー入力(zBoardKey)から除外する。
 *
 * 予約しないと `PRV99999` のようなキーを 1 つ作られるだけで nextSequentialKey が
 * MAX_BOARD_KEY を超えて採番できなくなり、プライベートボードを未作成の全ユーザーで
 * ensurePrivateBoard が恒久的に失敗する(= /tickets と /boards が開けなくなる)。
 */
export const isReservedBoardKey = (key: string): boolean => key.toUpperCase().startsWith(PRIVATE_BOARD_KEY_PREFIX)

/** 表示ID。利用者へ見せる識別子で、URL やチャットに貼れる単一の表記 */
export const ticketDisplayId = ({ key, number }: { key: string; number: number }): string => `${key}-${number}`

/** 検索語 / URL から表示IDを読み取る。数値は Int の範囲に収めるため 9 桁までとする */
const DISPLAY_ID_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,7})-(\d{1,9})$/

/** 表示IDの分解。形式外は null。キーは大文字へ寄せるので小文字で貼られても引ける */
export const parseTicketDisplayId = (raw: string): { key: string; number: number } | null => {
  const matched = DISPLAY_ID_PATTERN.exec(raw.trim())
  if (!matched) {
    return null
  }
  return { key: matched[1].toUpperCase(), number: Number(matched[2]) }
}

/** 表示IDで開ける短縮URLのパス。チャットや議事録に貼る想定の表記 */
export const ticketShortPath = (displayId: string): string => `/t/${displayId}`

/** コメントのアンカーID。通知URLのフラグメントと画面側の要素 id で同じ形を使う */
export const commentAnchorId = (commentId: string): string => `comment-${commentId}`

/** 短縮URLのパス(`/t/KEY-123`)。末尾スラッシュは許容する */
const SHORT_PATH_PATTERN = /^\/t\/([^/]+)\/?$/

/** チケット詳細のパス(`/tickets/<uuid>`)。アドレスバーからコピーするとこの形になる */
const DETAIL_PATH_PATTERN = /^\/tickets\/([^/]+)\/?$/

/**
 * チケットIDの形式(uuid v7)。`Ticket.id` は `@default(uuid(7))`。
 * 形式外を弾くのは、貼られた任意の文字列でチケットを引きにいかないため。
 */
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** 貼られた URL が指すチケット。引き方が変わるので参照の種類を持たせる */
export type TicketUrlRef = { kind: 'displayId'; value: string } | { kind: 'ticketId'; value: string }

/** URL の断片(パスセグメントやハッシュ)のデコード。`%20` 等で貼られても解決する。不正なエスケープは null */
export const decodeSegment = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/**
 * 貼られた URL からチケットの参照を取り出す。自サイトのチケットURLでなければ null。
 *
 * 短縮URL(`/t/KEY-123`)とチケット詳細(`/tickets/<uuid>`)の両方を受ける。
 * オリジン(protocol + host)まで一致を見るのは、他サイトの同じパスを
 * 自分のチケットとして解決してしまわないようにするため。
 */
export const parseTicketUrl = (url: string, baseUrl: string): TicketUrlRef | null => {
  let target: URL
  let base: URL
  try {
    target = new URL(url)
    base = new URL(baseUrl)
  } catch {
    return null
  }
  if (target.origin !== base.origin) {
    return null
  }

  const short = SHORT_PATH_PATTERN.exec(target.pathname)
  if (short) {
    const displayId = decodeSegment(short[1])
    // 表示IDそのものの形式検証は parseTicketDisplayId に任せる
    return displayId && parseTicketDisplayId(displayId) ? { kind: 'displayId', value: displayId } : null
  }

  const detail = DETAIL_PATH_PATTERN.exec(target.pathname)
  if (detail) {
    const ticketId = decodeSegment(detail[1])
    return ticketId && UUID_V7_PATTERN.test(ticketId) ? { kind: 'ticketId', value: ticketId } : null
  }

  return null
}

/** キー無しの番号指定(`12` / `#12`)。ボードを跨いで同じ番号がヒットする */
const TICKET_NUMBER_PATTERN = /^#?(\d{1,9})$/

export const parseTicketNumber = (raw: string): number | null => {
  const matched = TICKET_NUMBER_PATTERN.exec(raw.trim())
  return matched ? Number(matched[1]) : null
}

/**
 * `<prefix><連番>` 形式のキーの次の値。既存キーの最大 + 1(無ければ 1)。
 * プライベートボードのキー採番に使う(接頭辞の後ろが数字でないキーは無関係とみなす)。
 *
 * `maxLength` を超える桁になったら null を返す。BOARD_KEY_PATTERN を外れたキーで作られたボードは
 * チケットの表示IDを parseTicketDisplayId で解決できなくなるため、採番せず呼び出し側で失敗させる。
 */
export const nextSequentialKey = (prefix: string, keys: string[], maxLength: number = MAX_BOARD_KEY): string | null => {
  const max = keys.reduce((max, key) => {
    const rest = key.startsWith(prefix) ? key.slice(prefix.length) : ''
    if (!/^\d+$/.test(rest)) {
      return max
    }
    const seq = Number(rest)
    return seq > max ? seq : max
  }, 0)

  const key = `${prefix}${max + 1}`
  return key.length > maxLength ? null : key
}
