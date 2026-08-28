import { AgentRunAction } from '@/generated/prisma/enums'
import { agentError, agentJson, authenticateRunner, readJsonBody } from '@/lib/agent-api'
import { evaluateRunner, startAgentRun } from '@/lib/agent-runner'
import { z } from 'zod'

/**
 * 実行の開始を記録する。
 *
 * ランナーが Claude を起動する直前に呼ぶ。ここでチケットを処理中にすることで、
 * 次のポーリングで同じチケットを二重に拾わないようにする。
 */

const scBody = z.object({
  ticketId: z.uuidv7(),
  action: z.enum(AgentRunAction),
})

export const POST = async (request: Request) => {
  const result = await authenticateRunner(request)
  if (!result.ok) {
    return result.response
  }
  const { runner } = result.ctx

  const parsed = scBody.safeParse(await readJsonBody(request))
  if (!parsed.success) {
    return agentError(400, 'invalid_request')
  }

  const activity = evaluateRunner(runner)
  if (!runner || !activity.active) {
    return agentError(409, activity.reason ?? 'inactive')
  }

  const run = await startAgentRun(runner, parsed.data.ticketId, parsed.data.action)
  if (!run) {
    return agentError(404, 'ticket_not_available')
  }

  return agentJson({ runId: run.id, displayId: run.displayId })
}
