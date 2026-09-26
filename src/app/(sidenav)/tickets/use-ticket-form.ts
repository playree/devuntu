'use client'

import { useActionData } from '@/lib/action/action-client'
import { getAssigneeOptions, getTicketFormOptions, GetTicketFormOptionsReturnType } from './server'

export type TicketFormOptions = NonNullable<GetTicketFormOptionsReturnType>
export type BoardAssignee = NonNullable<Awaited<ReturnType<typeof getAssigneeOptions>>['data']>[number]

/**
 * チケットのフォームの選択肢(ボード・タグなど)。
 * 呼び出し元がすでに持っている場合は initial を渡すと取得しない。
 */
export const useTicketFormOptions = (initial?: TicketFormOptions) => {
  const { data, reload } = useActionData(getTicketFormOptions, { skip: !!initial })
  return { options: initial ?? data, reload }
}

/**
 * ボードの担当者候補(プライベートボードなら本人のみ)。
 * 呼び出し元が取得済みの候補を持っている場合は initial を渡すと取得しない。
 * isLoaded は取得に成功したかどうか。失敗・取得中は false で、他へ渡すかの判断に使う
 */
export const useBoardAssignees = (boardId: string | undefined, initial?: BoardAssignee[]) => {
  const { data } = useActionData(() => getAssigneeOptions({ id: boardId ?? '' }), {
    skip: !boardId || !!initial,
    key: boardId,
  })

  if (initial) {
    return { assignees: initial, isLoaded: true }
  }
  return { assignees: data ?? [], isLoaded: !!boardId && !!data }
}
