'use client'

import { getCookie, setCookie } from '@/components/general/cookie/client'
import { defaultKanbanFilter, KANBAN_DONE_DAYS_OPTIONS, KanbanFilter } from '@/lib/board/task'
import { useEffect, useState } from 'react'

/**
 * 完了カードの表示期間を保存する Cookie。
 * ボードごとではなくユーザーの好みとして扱うので、すべてのボードで同じ値を共有する
 */
const DONE_DAYS_COOKIE = 'kanban-done-days'
const DONE_DAYS_COOKIE_MAX_AGE = 86400 * 365

/**
 * かんばんの絞り込み状態。
 *
 * 完了カードの表示期間だけは次回以降も同じ見え方で開けるよう Cookie に残す
 * (担当者・優先度・タグ・期日はその場の作業のための条件なので残さない)。
 * Cookie は SSR では読めないため、初期値は既定のままにしてハイドレーション後に前回の選択へ寄せる。
 */
export const useKanbanFilter = () => {
  const [filter, setFilter] = useState<KanbanFilter>(defaultKanbanFilter)

  useEffect(() => {
    const saved = Number(getCookie(DONE_DAYS_COOKIE))
    if (KANBAN_DONE_DAYS_OPTIONS.includes(saved)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilter((prev) => ({ ...prev, doneDays: saved }))
    }
  }, [])

  const changeFilter = (next: KanbanFilter) => {
    setFilter(next)
    if (next.doneDays !== filter.doneDays) {
      setCookie(DONE_DAYS_COOKIE, String(next.doneDays), { maxAge: DONE_DAYS_COOKIE_MAX_AGE, path: '/' })
    }
  }

  return [filter, changeFilter] as const
}
