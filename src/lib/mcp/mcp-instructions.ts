/**
 * MCP クライアント(Claude / Codex など)へ伝える、チケット対応の作法
 *
 * 利用者がルールを書かなくても、plan / report のコメントと成果物の紐付けを使ってもらうための既定値。
 * クライアントによって届く経路が違うので、同じ手順を3か所に載せる。文言はこのファイルだけで持つ。
 * - 初期化応答の `instructions`: Claude Code はシステムプロンプトに取り込む
 * - ツールの description: どのクライアントでも読まれる
 * - `get_ticket` の応答の `workflow`: 作業の直前に必ず読まれる(instructions を使わないクライアント向け)
 */

import type { ResourceAuth } from '../oauth/oauth-resource'

/** チケットに対応するときの手順(人の経路の既定) */
export const TICKET_WORKFLOW = [
  'When starting: set status to doing with update_ticket (leave it unchanged if already doing / done)',
  'Once you have a plan: post it with add_ticket_comment using type=plan',
  'Questions for the user: post them as a regular comment without type',
  'After creating a branch / pull request / commit: link the URL with link_ticket_artifact (naming the branch feature/<display ID> links it automatically for repositories connected to the board)',
  'When done: post a report with add_ticket_comment using type=report covering what you did, how you verified it, and any remaining issues (attach screenshots via create_image_upload_token)',
] as const

/** 手順より優先するもの。既定値であることを必ず添える */
const PRECEDENCE =
  'If the user instructions or project rules (CLAUDE.md / AGENTS.md, etc.) say otherwise, follow them. ' +
  'When you are only asked to read a ticket or answer a question, do not post comments or change the status.'

/**
 * `get_ticket` の応答に載せる手順。実行できる人(チケットを編集できる人の経路)にだけ返す。
 * エージェントはランナーの指示と get_agent_task の rule に従うので載せない(自動運用の流れと食い違わせない)。
 */
export const ticketWorkflowFor = (kind: ResourceAuth['kind'], canEdit: boolean): readonly string[] | undefined =>
  kind !== 'agent' && canEdit ? [...TICKET_WORKFLOW, PRECEDENCE] : undefined

/** 初期化応答に載せる instructions */
export const mcpInstructions = (kind: ResourceAuth['kind']): string => {
  const common = [
    'devuntu is a kanban-style ticket management tool. ticketId accepts a display ID (e.g. ABC-42).',
    'Comment types: type=plan is a work plan and type=report is a work report; both are shown separately from regular comments on the detail screen.',
    'Link GitHub / GitLab branches / pull requests (merge requests) / commits to a ticket with link_ticket_artifact to show their state and CI results on the ticket.',
  ]
  if (kind === 'agent') {
    return [
      ...common,
      'In automated operation, follow the rule returned by get_agent_task and the runner instructions, and finally report the result with finish_agent_task.',
    ].join('\n')
  }
  return [
    ...common,
    '',
    'When working from a ticket, follow these steps by default (no need to ask for confirmation each time).',
    ...TICKET_WORKFLOW.map((step, i) => `${i + 1}. ${step}`),
    '',
    PRECEDENCE,
  ].join('\n')
}
