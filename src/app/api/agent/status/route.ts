import { agentError, agentJson, authenticateRunner, readJsonBody } from '@/lib/agent-api'
import { activeWindowLabel, evaluateRunner, failStaleAgentRuns, pickAgentTasks } from '@/lib/agent-runner'
import { nowDate } from '@/lib/day'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

/**
 * ランナーのポーリング先。
 *
 * 「いま動いてよいか(稼働条件)」と「処理すべきチケット」を返すだけで、Claude は起動しない。
 * 5分おきに叩かれる前提なので、チケットの本文やコメントは返さず MCP 側に任せる。
 *
 * ランナーの自己申告(ホスト名・版)は稼働状況の表示にしか使わない。認可には一切関与しない。
 */

const scBody = z.object({
  hostname: z.string().max(255).optional(),
  version: z.string().max(50).optional(),
})

export const POST = async (request: Request) => {
  const result = await authenticateRunner(request)
  if (!result.ok) {
    return result.response
  }
  const { auth, runner } = result.ctx

  const parsed = scBody.safeParse(await readJsonBody(request))
  if (!parsed.success) {
    return agentError(400, 'invalid_request')
  }

  const now = nowDate()
  if (runner) {
    await prisma.agentRunner.update({
      where: { id: runner.id },
      data: { lastPolledAt: now, hostname: parsed.data.hostname, version: parsed.data.version },
    })
  }

  const activity = evaluateRunner(runner, now)
  // 稼働できないときは作業を渡さない。渡してしまうとランナー側の実装次第で動き出せてしまう
  if (!runner || !activity.active) {
    return agentJson({
      agent: { id: auth.user.id, name: auth.user.name, email: auth.user.email },
      ...activity,
      activeWindow: runner ? activeWindowLabel(runner) : null,
      pollIntervalSec: runner?.pollIntervalSec ?? null,
      tasks: [],
    })
  }

  await failStaleAgentRuns(runner.id, now)

  return agentJson({
    agent: { id: auth.user.id, name: auth.user.name, email: auth.user.email },
    ...activity,
    activeWindow: activeWindowLabel(runner),
    pollIntervalSec: runner.pollIntervalSec,
    tasks: await pickAgentTasks(runner),
  })
}
