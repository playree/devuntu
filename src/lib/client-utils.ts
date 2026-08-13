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
