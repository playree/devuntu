import { agentError, agentJson, authenticateRunner } from '@/lib/agent/agent-api'
import { CANCELED_SUMMARY, cancelAgentRun } from '@/lib/agent/agent-run'

/**
 * 自分の実行中の実行を停止する。failed(要約 `canceled`)で閉じ、チケットの処理状態を失敗にする。
 *
 * ランナーが再起動などで CLI を見失ったときの後始末に使うので、稼働条件(無効・時間外)に関係なく使える。
 * 他のランナーの実行は 404、既に閉じた実行は 409(`not_running`)。
 */
export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const result = await authenticateRunner(request)
  if (!result.ok) {
    return result.response
  }
  const { runner } = result.ctx
  if (!runner) {
    return agentError(409, 'no_runner')
  }

  const { id } = await params
  const canceled = await cancelAgentRun({ runId: id, runnerId: runner.id })
  if (canceled === 'not_found') {
    return agentError(404, 'run_not_found')
  }
  if (canceled === 'not_running') {
    return agentError(409, 'not_running')
  }
  return agentJson({ id, status: 'failed', summary: CANCELED_SUMMARY })
}
