'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { isAdminActor } from '@/lib/board/board'
import { readLogChunks } from '@/lib/command/command-log'
import { getCommandRun } from '@/lib/command/command-run'
import { errNotFound } from '@/lib/error'
import { z } from 'zod'

/** 1回の取得で返すチャンクの上限 */
const PAGE = 500

const scRunLogs = z.object({
  id: z.uuidv7(),
  /** このseqより後ろを返す。0 なら先頭から */
  afterSeq: z.number().int().min(0),
})

/**
 * 実行の状態とログの続きをまとめて返す。
 *
 * Phase 4 で SSE を足すが、この経路は SSE が使えない環境と履歴の表示のために残す。
 * どちらも `seq` のカーソルで続きを引くだけなので、
 * 「途中から見る」「リロード後の再開」「終了後の閲覧」が同じ形で解ける。
 */
export const getCommandRunLogsAction = safeAuthAction
  .metadata({ actionName: 'getCommandRunLogs', role: 'user' })
  .inputSchema(scRunLogs)
  .action(async ({ parsedInput: { id, afterSeq }, ctx: { user } }) => {
    const run = await getCommandRun(id)
    // 存在を漏らさないため、権限が無い場合も「無い」と同じ扱いにする
    if (!run || (run.userId !== user.id && !isAdminActor(user))) {
      throw errNotFound()
    }
    const chunks = await readLogChunks(id, afterSeq, PAGE)
    return { run, chunks }
  })

export type GetCommandRunLogsReturnType = Awaited<ReturnType<typeof getCommandRunLogsAction>>['data']
