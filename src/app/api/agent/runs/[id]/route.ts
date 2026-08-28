import { agentError, agentJson, authenticateRunner, readJsonBody } from '@/lib/agent-api'
import { finishAgentRunById } from '@/lib/agent-runner'
import { z } from 'zod'

/**
 * 実行の終了を記録する。
 *
 * Claude が `finish_agent_task` を呼ばずに落ちた場合の保険も兼ねており、チケットが処理中のまま
 * 残っていれば失敗として閉じる(`finishAgentRunById`)。ランナーは Claude の終了コードしか
 * 知らないので、チケットの状態そのものはエージェントの報告を優先する。
 */

const scBody = z.object({
  status: z.enum(['succeeded', 'failed', 'skipped']),
  summary: z.string().max(2000).optional(),
})

export const PATCH = async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const result = await authenticateRunner(request)
  if (!result.ok) {
    return result.response
  }
  const { runner } = result.ctx
  if (!runner) {
    return agentError(409, 'no_runner')
  }

  const parsed = scBody.safeParse(await readJsonBody(request))
  if (!parsed.success) {
    return agentError(400, 'invalid_request')
  }

  const { id } = await params
  const updated = await finishAgentRunById(runner.id, id, parsed.data.status, parsed.data.summary)
  if (!updated) {
    return agentError(404, 'run_not_found')
  }

  return agentJson({ id })
}
