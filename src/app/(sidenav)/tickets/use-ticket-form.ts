'use client'

import { parseAction } from '@/lib/action/action-client'
import { useCallback, useEffect, useState } from 'react'
import { getAssigneeOptions, getTicketFormOptions, GetTicketFormOptionsReturnType } from './server'

export type TicketFormOptions = NonNullable<GetTicketFormOptionsReturnType>
export type BoardAssignee = NonNullable<Awaited<ReturnType<typeof getAssigneeOptions>>['data']>[number]

/**
 * チケットのフォームの選択肢(ボード・タグなど)。
 * 呼び出し元がすでに持っている場合は initial を渡すと取得しない。
 */
export const useTicketFormOptions = (initial?: TicketFormOptions) => {
  const [options, setOptions] = useState<TicketFormOptions | undefined>(initial)

  const reload = useCallback(() => {
    parseAction(getTicketFormOptions(), { handled: 'all' })
      .then((res) => setOptions(res ?? undefined))
      .catch(() => setOptions(undefined))
  }, [])

  const hasInitial = !!initial
  useEffect(() => {
    if (!hasInitial) {
      reload()
    }
  }, [hasInitial, reload])

  return { options: initial ?? options, reload }
}

/**
 * ボードの担当者候補(プライベートボードなら本人のみ)。
 * ボードを続けて切り替えると古い要求が後着しうるので、対象が変わった結果は捨てる。
 * 呼び出し元が取得済みの候補を持っている場合は initial を渡すと取得しない。
 * isLoaded は取得に成功したかどうか。失敗・取得中は false で、他へ渡すかの判断に使う
 */
export const useBoardAssignees = (boardId: string | undefined, initial?: BoardAssignee[]) => {
  const [loaded, setLoaded] = useState<{ boardId?: string; items: BoardAssignee[] }>({ items: [] })

  const hasInitial = !!initial
  useEffect(() => {
    if (!boardId || hasInitial) {
      return
    }
    let isCurrent = true
    parseAction(getAssigneeOptions({ id: boardId }), { handled: 'all' })
      .then((res) => isCurrent && setLoaded({ boardId, items: res ?? [] }))
      // 失敗は未取得のまま(isLoaded = false)にする
      .catch(() => {})
    return () => {
      isCurrent = false
    }
  }, [boardId, hasInitial])

  if (initial) {
    return { assignees: initial, isLoaded: true }
  }
  // 別のボードの候補が残って見えないよう、取得が済むまでは空にする
  const isLoaded = !!boardId && loaded.boardId === boardId
  return { assignees: isLoaded ? loaded.items : [], isLoaded }
}
