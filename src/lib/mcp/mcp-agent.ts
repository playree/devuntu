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
const INACTIVE_NOTE = 'Run conditions are not met. Exit without processing any ticket. Do not post any comments either.'

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
      title: 'Agent setup guide',
      description:
        'Returns the steps to set up automated AI agent operation (Devuntu Agent) on your machine, ' +
        'from preparing the working directory to fetching and configuring the runner, registering cron, and verifying it works. ' +
        'The user chooses which CLI to run it with, so when called without cli it returns an instruction to ask the user instead of the steps',
      inputSchema: {
        cli: z
          .enum(AGENT_CLI_KINDS)
          .optional()
          .describe('CLI to set up. claude=Claude Code / codex=Codex CLI. Ask the user before specifying'),
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
      title: 'Get rule and tasks',
      description:
        'Always call this before processing a ticket. Returns the run conditions (whether active and the allowed hours), the tickets to process, ' +
        'the action to perform, and the rule instructions. Follow the rule throughout the whole run. ' +
        'If active is false, exit without doing anything',
      inputSchema: {
        ticketId: z
          .string()
          .min(1)
          .optional()
          .describe('Target ticket (display ID allowed). Omit to get the list of tickets waiting to be processed'),
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
          note: 'This ticket is not a current processing target. Exit without processing it',
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
      title: 'Report task result',
      description:
        'Reports the result of processing a ticket and closes the run. ' +
        'planned=plan posted and waiting for a reply, completed=done, skipped=skipped, failed=failed. ' +
        'If the ticket has acceptance criteria, completed must report every item as met with evidence in criteria',
      inputSchema: {
        ticketId: z.string().min(1),
        outcome: z.enum(AGENT_OUTCOMES),
        summary: z.string().max(2000).optional().describe('Summary of the result recorded in the run history'),
        criteria: z
          .array(
            z.object({
              id: z.uuidv7().describe('id from acceptanceCriteria in get_agent_task'),
              met: z.boolean().describe('Whether the criterion is met'),
              evidence: zCriterionEvidence.describe(
                'Evidence for the judgment (what was checked, test results, relevant code, etc.)',
              ),
            }),
          )
          .max(MAX_TICKET_CRITERIA)
          .optional()
          .describe('Self-check result for each acceptance criterion'),
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
