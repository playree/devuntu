/**
 * サイドメニューの幅(px)の範囲と、保存した値の読み取り
 *
 * サーバー(レイアウトで Cookie から初期幅を読む)とクライアント(ドラッグで幅を変える)の双方から使う。
 */

export const SIDE_NAV_WIDTH_MIN = 208
export const SIDE_NAV_WIDTH_DEFAULT = 256
export const SIDE_NAV_WIDTH_MAX = 480
/** キー操作で動かす幅 */
export const SIDE_NAV_WIDTH_STEP = 16

/** 幅を保存する Cookie。画面ごとではなくユーザーの好みとして全画面で共有する */
export const SIDE_NAV_WIDTH_COOKIE = 'side-nav-width'
export const SIDE_NAV_WIDTH_COOKIE_MAX_AGE = 86400 * 365

/** 範囲内に丸めた整数の幅 */
export const clampSideNavWidth = (width: number): number =>
  Math.min(Math.max(Math.round(width), SIDE_NAV_WIDTH_MIN), SIDE_NAV_WIDTH_MAX)

/** 保存された値から幅を読む。未保存・数値でない値は既定の幅にする */
export const parseSideNavWidth = (raw: string | null | undefined): number => {
  const value = Number(raw)
  return raw && Number.isFinite(value) ? clampSideNavWidth(value) : SIDE_NAV_WIDTH_DEFAULT
}
