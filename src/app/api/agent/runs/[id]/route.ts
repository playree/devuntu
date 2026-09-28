import { agentError, agentJson, authenticateRunner, readJsonBody } from '@/lib/agent/agent-api'
import { finishAgentRunById } from '@/lib/agent/agent-run'
import { z } from 'zod'

/**
 * 実行の終了を記録する。
 *
 * Claude が `finish_agent_task` を呼ばずに落ちた場合の保険も兼ねており、チケットが処理中のまま
 * 残っていれば失敗として閉じる(`finishAgentRunById`)。ランナーは Claude の終了コードしか
 * 知らないので、チケットの状態そのものはエージェントの報告を優先する。
 *
 * `metrics` は CLI の出力から取れた計測値。古いランナーは送らないので省略できる。
 */

const scCount = z.number().int().min(0).max(2_000_000_000).nullish()

const scBody = z.object({
  status: z.enum(['succeeded', 'failed', 'skipped']),
  summary: z.string().max(2000).optional(),
  metrics: z
    .object({
      model: z.string().max(100).nullish(),
      inputTokens: scCount,
      cachedInputTokens: scCount,
      outputTokens: scCount,
      costUsd: z.number().min(0).max(100_000).nullish(),
      exitCode: z.number().int().min(-1000).max(1000).nullish(),
    })
    .optional(),
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
  const { status, summary, metrics } = parsed.data
  const updated = await finishAgentRunById(runner, id, status, summary, metrics)
  if (!updated) {
    return agentError(404, 'run_not_found')
  }

  return agentJson({ id })
}
