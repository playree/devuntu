/**
 * ダッシュボードの「最近のリモート実行」Widget 用の取得処理(サーバー専用)。
 *
 * 表示条件はサイドメニューと同じ `canUseAnyCommand`。満たさなければ履歴を引かずに空を返す。
 */

import { type Actor } from '../board/board-access'
import { prisma } from '../prisma'
import { canUseAnyCommand } from './command-access'

/** 表示件数 */
export const COMMAND_RUNS_WIDGET_LIMIT = 10

/** 自分が実行したリモート実行の最近の結果(新しい順) */
export const listMyRecentCommandRuns = async (actor: Actor) => {
  if (!(await canUseAnyCommand(actor))) {
    return []
  }

  return await prisma.commandRun.findMany({
    where: { userId: actor.id },
    select: {
      id: true,
      commandLabel: true,
      targetLabel: true,
      status: true,
      queuedAt: true,
      finishedAt: true,
    },
    orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
    take: COMMAND_RUNS_WIDGET_LIMIT,
  })
}
