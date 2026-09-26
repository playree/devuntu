/**
 * 自動運用(Devuntu Agent)のための MCP ツール(サーバー専用)
 *
 * ランナーが Claude を起動したあと、Claude 自身が「処理してよいか」「何をするか」を確かめ、
 * 結果を書き戻すための口。エージェント用の長期トークンで接続した場合だけ登録するので、
 * 人間の MCP クライアントからは見えない(`createDevuntuMcpServer`)。
 *
 * 稼働条件はランナー側(`/api/agent/status`)でも見ているが、起動してから時間が経つこともあるので
 * `get_agent_task` でもう一度判定する。処理を見送る判断は Claude に委ねる。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { AGENT_CLI_KINDS } from '../agent/agent'
import { activeWindowLabel, evaluateRunnerActivity } from '../agent/agent-activity'
import { findLatestAgentDecision } from '../agent/agent-decision'
import { AGENT_OUTCOMES, finishAgentTask } from '../agent/agent-run'
import { findAgentRunner } from '../agent/agent-runner'
import { agentSetupCliPrompt, agentSetupGuide } from '../agent/agent-setup'
import { findAgentTicket, pickAgentTasks, resolveAgentTask } from '../agent/agent-task'
import { assertTicketAccess } from '../board/board-access'
import { listTicketCriteria } from '../board/ticket-criterion'
import { errInvalidOperation } from '../error'
import type { ResourceAuth } from '../oauth/oauth-resource'
import { MAX_TICKET_CRITERIA, zCriterionEvidence } from '../schema/schema-ticket'
import { jsonResult } from './mcp'
import { resolveTicketId } from './mcp-ticket'

/** 稼働条件を満たさないときに Claude へ返す指示。判断の余地を残さない文にする */
const INACTIVE_NOTE = '稼働条件を満たしていないため、チケットの処理は行わずに終了すること。コメントの投稿も行わない。'

/** 自動運用の設定と稼働条件をまとめて引く。3ツールとも入口はこれ */
const loadContext = async (auth: ResourceAuth) => {
  const runner = await findAgentRunner(auth.user.id)
  return { runner, activity: await evaluateRunnerActivity(runner) }
}

/**
 * セットアップ手順を返すツール。
 *
 * ランナーを仕込むのは人の作業なので、エージェント用トークンだけでなく通常の MCP 接続からも使える。
 * 手順の本文は `agent-setup.ts` にあり、URL はこのサーバーのものが埋め込まれる。
 */
export const registerAgentSetupTool = (server: McpServer) => {
  server.registerTool(
    'get_agent_setup_guide',
    {
      title: '自動運用のセットアップ手順',
      description:
        'AIエージェントの自動運用(Devuntu Agent)を自分のマシンへ用意する手順を返す。' +
        '作業ディレクトリの準備からランナーの取得・設定・cron 登録・動作確認までを含む。' +
        'どの CLI で動かすかは利用者が選ぶため、cli を指定せずに呼んだ場合は手順ではなく確認の指示を返す',
      inputSchema: {
        cli: z
          .enum(AGENT_CLI_KINDS)
          .optional()
          .describe('セットアップに使う CLI。claude=Claude Code / codex=Codex CLI。利用者に確認して指定する'),
      },
    },
    async ({ cli }) => ({
      content: [{ type: 'text' as const, text: cli ? agentSetupGuide(cli) : agentSetupCliPrompt() }],
    }),
  )
}

export const registerAgentTools = (server: McpServer, auth: ResourceAuth) => {
  server.registerTool(
    'get_agent_task',
    {
      title: 'ルールとタスクの取得',
      description:
        'チケットを処理する前に必ず呼ぶ。稼働条件(稼働可否と許可時間帯)、処理すべきチケット、' +
        '実行すべきアクション、ルールの指示を返す。ルールは処理全体を通じて従うこと。' +
        'active が false の場合は何もせず終了する',
      inputSchema: {
        ticketId: z
          .string()
          .min(1)
          .optional()
          .describe('対象チケット(表示ID可)。省略すると処理待ちのチケット一覧を返す'),
      },
    },
    async ({ ticketId }) => {
      const { runner, activity } = await loadContext(auth)
      const base = {
        agent: { name: auth.user.name, email: auth.user.email },
        ...activity,
        activeWindow: runner ? activeWindowLabel(runner) : null,
      }
      if (!runner || !activity.active) {
        return jsonResult({ ...base, task: null, tasks: [], note: INACTIVE_NOTE })
      }

      const rule = runner.rule ?? null
      if (!ticketId) {
        return jsonResult({ ...base, rule, tasks: await pickAgentTasks(runner) })
      }

      // ランナーは起動前に実行を開始するので、名指しのチケットは待ち行列には載っていない
      const id = await resolveTicketId(auth, ticketId)
      const task = await resolveAgentTask(runner, id)
      if (!task) {
        return jsonResult({
          ...base,
          rule,
          task,
          note: 'このチケットは現在の処理対象ではない。処理せずに終了すること',
        })
      }

      const [criteria, decision] = await Promise.all([
        listTicketCriteria(id),
        task.action === 'revise' ? findLatestAgentDecision(id, auth.user.id) : null,
      ])
      return jsonResult({
        ...base,
        rule,
        task: {
          ...task,
          /** 完了の基準。completed で終えるときは finish_agent_task の criteria で各項目の充足を報告する */
          acceptanceCriteria: criteria.map(({ id: criterionId, text }) => ({ id: criterionId, text })),
          /** revise のきっかけになった承認 / 差し戻し。ボタンを使わない返信だけなら null */
          decision: decision ? { kind: decision.decision, commentId: decision.id, content: decision.content } : null,
        },
        note: null,
      })
    },
  )

  server.registerTool(
    'finish_agent_task',
    {
      title: '処理結果の報告',
      description:
        'チケットの処理結果を報告して1回の実行を閉じる。' +
        'planned=プランを投稿して返信待ち、completed=対応完了、skipped=見送り、failed=失敗。' +
        'チケットに受け入れ条件がある場合、completed では criteria で全項目の充足を根拠つきで報告する',
      inputSchema: {
        ticketId: z.string().min(1),
        outcome: z.enum(AGENT_OUTCOMES),
        summary: z.string().max(2000).optional().describe('実行履歴に残す結果の要約'),
        criteria: z
          .array(
            z.object({
              id: z.uuidv7().describe('get_agent_task の acceptanceCriteria の id'),
              met: z.boolean().describe('条件を満たしたか'),
              evidence: zCriterionEvidence.describe('そう判断した根拠(確認した内容・テスト結果・該当箇所など)'),
            }),
          )
          .max(MAX_TICKET_CRITERIA)
          .optional()
          .describe('受け入れ条件ごとの自己チェック結果'),
      },
    },
    async ({ ticketId, outcome, summary, criteria }) => {
      const { runner } = await loadContext(auth)
      const id = await resolveTicketId(auth, ticketId)
      await assertTicketAccess(auth.user, id, 'edit')

      // 担当・オプトインの条件は開始時と同じものを使う。外れている場合は報告先が無い
      const ticket = await findAgentTicket(auth.user.id, id)
      if (!ticket) {
        throw errInvalidOperation()
      }

      const { state } = await finishAgentTask(runner, id, outcome, summary, criteria)
      return jsonResult({ displayId: ticket.displayId, outcome, state })
    },
  )
}
