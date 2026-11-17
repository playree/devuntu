import { AgentRunAction, AgentRunStatus } from '@/generated/prisma/enums'
import { evaluateRunner } from '@/lib/agent/agent-activity'
import { agentError, agentJson, authenticateRunner, readJsonBody } from '@/lib/agent/agent-api'
import { findRequestedAgentRun, startAgentRun, type StartAgentRunResult } from '@/lib/agent/agent-run'
import { AGENT_RUN_LIST_MAX_LIMIT, listRunnerAgentRuns } from '@/lib/agent/agent-run-recovery'
import { z } from 'zod'

/**
 * 実行の開始を記録する(POST)/ 自分の実行の一覧を返す(GET)。
 *
 * 開始はランナーが Claude を起動する直前に呼ぶ。ここでチケットを処理中にすることで、
 * 次のポーリングで同じチケットを二重に拾わないようにする。
 * `requestId` を付けた開始要求は、応答を失って再送しても既存の実行を返す(稼働条件を外れた後の再送も同じ)。
 *
 * 一覧は中断後の照合に使うので、稼働条件(無効・時間外)に関係なく返す。
 */

const zRequestId = z.string().min(1).max(100)

const scBody = z.object({
  ticketId: z.uuidv7(),
  action: z.enum(AgentRunAction),
  requestId: zRequestId.optional(),
})

const startedJson = (started: Extract<StartAgentRunResult, { ok: true }>) =>
  agentJson({ runId: started.run.id, displayId: started.run.displayId, status: started.run.status })

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
  const { ticketId, action, requestId } = parsed.data

  // 再送は稼働条件より先に照合する(開始済みの実行を、稼働時間を過ぎたことで見失わせない)
  const requested = runner && requestId ? await findRequestedAgentRun(runner.id, requestId, ticketId) : null
  if (requested) {
    return requested.ok ? startedJson(requested) : agentError(409, requested.reason)
  }

  const activity = evaluateRunner(runner)
  if (!runner || !activity.active) {
    return agentError(409, activity.reason ?? 'inactive')
  }

  const started = await startAgentRun(runner, ticketId, action, requestId)
  if (!started.ok) {
    return agentError(started.reason === 'ticket_not_available' ? 404 : 409, started.reason)
  }

  return startedJson(started)
}

const scQuery = z.object({
  status: z.enum(AgentRunStatus).optional(),
  ticketId: z.uuidv7().optional(),
  requestId: zRequestId.optional(),
  limit: z.coerce.number().int().min(1).max(AGENT_RUN_LIST_MAX_LIMIT).optional(),
})

export const GET = async (request: Request) => {
  const result = await authenticateRunner(request)
  if (!result.ok) {
    return result.response
  }
  const { runner } = result.ctx
  if (!runner) {
    return agentError(409, 'no_runner')
  }

  const parsed = scQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) {
    return agentError(400, 'invalid_request')
  }

  return agentJson({ runs: await listRunnerAgentRuns(runner.id, parsed.data) })
}
