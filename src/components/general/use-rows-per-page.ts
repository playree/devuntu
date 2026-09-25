'use client'

import { useEffect, useState } from 'react'
import { getCookie, setCookie } from './cookie/client'

/** 表示件数の選択肢。ページャの Select と Cookie 値の検証で共有する */
export const ROWS_PER_PAGE_OPTIONS = [10, 20, 50, 100]

/**
 * 表示件数を保存する Cookie。
 * 一覧ごとではなくユーザーの好みとして扱うので、すべての一覧で同じ値を共有する
 */
const ROWS_PER_PAGE_COOKIE = 'rows-per-page'
const ROWS_PER_PAGE_COOKIE_MAX_AGE = 86400 * 365

/**
 * 表示件数の状態。クライアント側 / サーバー側ページングの両方で共有する。
 *
 * Cookie は SSR では読めないため、初期値は fallback にしてハイドレーション後に前回の選択へ寄せる
 * (初期描画で読むとサーバーの出力と一致しない)
 */
export const useRowsPerPage = (fallback: number) => {
  const [state, setState] = useState({ rows: fallback, restored: false })

  useEffect(() => {
    const saved = Number(getCookie(ROWS_PER_PAGE_COOKIE))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ rows: ROWS_PER_PAGE_OPTIONS.includes(saved) ? saved : fallback, restored: true })
  }, [fallback])

  // 次回以降も同じ件数で開けるよう Cookie に残す
  const changeRowsPerPage = (rows: number) => {
    setState({ rows, restored: true })
    setCookie(ROWS_PER_PAGE_COOKIE, String(rows), { maxAge: ROWS_PER_PAGE_COOKIE_MAX_AGE, path: '/' })
  }

  // restored は「Cookie を反映済みか」。サーバー側ページングで既定件数のままの取得を1回無駄打ちしないために使う
  return [state.rows, changeRowsPerPage, state.restored] as const
}
