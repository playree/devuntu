import { ReadonlyURLSearchParams } from 'next/navigation'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'

/**
 * 一覧の行やカードの中に置いたリンクを押したときに、親側の選択(詳細パネルの開閉)を
 * 起こさないためのハンドラ。親の押下判定は pointerdown / click / keydown 起点なので、
 * リンク側でイベントを止める。
 *
 * stopPropagation は React の合成イベントにしか効かないため、要素へ直接 addEventListener
 * している dnd-kit のセンサーには影響しない(かんばんでリンク上のドラッグが始まらないのは
 * dnd-kit 既定の preventActivation が a[href] を弾いているため)。
 */
export const preventParentSelection = {
  onPointerDown: (e: ReactPointerEvent) => e.stopPropagation(),
  onClick: (e: ReactMouseEvent) => e.stopPropagation(),
  onKeyDown: (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation()
    }
  },
}

/**
 * 押しても「空白」とみなさない要素。操作できる要素・選択対象(表の行、`data-keep-selection`)・
 * ダイアログ(詳細パネル自身やモーダル)・ポップオーバーの中身。
 */
const NOT_BLANK_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[role="row"]',
  '[role="gridcell"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="menu"]',
  '[role="menuitem"]',
  // react-aria の usePress を使う部品(role を持たないものもある)
  '[data-react-aria-pressable]',
  '[data-keep-selection]',
].join(',')

/**
 * area 内の空白(操作できる要素の外)を押したか。area を包む要素(area の下に残るページの余白)も空白とみなし、
 * それ以外の area の外(サイドメニューやポータルに出るモーダル・ポップオーバー)は対象外にする。
 */
export const isBlankTarget = (target: EventTarget | null, area: Element) =>
  target instanceof Element && (target.contains(area) || (area.contains(target) && !target.closest(NOT_BLANK_SELECTOR)))

/**
 * 認証後の遷移先として安全な値だけを通す。
 *
 * `cb` はクエリ文字列で渡ってくる = 攻撃者が自由に指定できるため、検証せずに `router.push` すると
 * 「正規のサインイン画面でログインした直後に外部サイトへ飛ばされる」オープンリダイレクトになる。
 * 同一オリジンならパス(+クエリ/ハッシュ)へ畳み、他オリジン・`//host`・`javascript:` は落とす。
 */
export const safeCallbackPath = (raw: string | null | undefined, fallback: string = '/') => {
  if (!raw || typeof window === 'undefined') {
    return fallback
  }
  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) {
      return fallback
    }
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

/**
 * 認証状態が変わった後の遷移。
 *
 * `router.push` だと、未認証で踏んだパスに対して proxy が返したリダイレクト先が
 * クライアントのルートキャッシュへ static の staleTime(既定5分)で残るため、
 * ログイン後の遷移までサインイン画面へ差し戻されてしまう。
 * 認証状態が変わった直後はツリーごと作り直す必要もあるので、フルナビゲーションで遷移する。
 */
export const navigateAfterAuth = (path: string) => {
  window.location.assign(path)
}

export const makePath = (path: string, params?: Record<string, string> | ReadonlyURLSearchParams) => {
  if (params) {
    if (params instanceof ReadonlyURLSearchParams) {
      return `${path}?${params}`
    }
    const queryString = new URLSearchParams(params).toString()
    return `${path}?${queryString}`
  }
  return path
}
