/**
 * MCP クライアント(Claude / Codex など)へ伝える、チケット対応の作法
 *
 * 利用者がルールを書かなくても、plan / report のコメントと成果物の紐付けを使ってもらうための既定値。
 * クライアントによって届く経路が違うので、同じ手順を3か所に載せる。文言はこのファイルだけで持つ。
 * - 初期化応答の `instructions`: Claude Code はシステムプロンプトに取り込む
 * - ツールの description: どのクライアントでも読まれる
 * - `get_ticket` の応答の `workflow`: 作業の直前に必ず読まれる(instructions を使わないクライアント向け)
 *
 * instructions は「ボードの前提 / 情報の残し先 / 手順 / 優先順位」の節に分け、同じ案内を2か所に書かない。
 */

import type { ResourceAuth } from '../oauth/oauth-resource'

/** チケットに対応するときの手順(人の経路の既定) */
export const TICKET_WORKFLOW = [
  'Start: set status to doing with update_ticket (unless already doing / done)',
  'Plan: post it with add_ticket_comment type=plan. Questions for the user: comments without type',
  'Branch / PR / commit: link the URL with link_ticket_artifact (feature/<display ID> branches link automatically)',
  'Done: if the ticket has acceptance criteria, record whether each is met with evidence via report_acceptance_criteria (not in the report)',
  'Report: add_ticket_comment type=report with what you did, how you verified it, and remaining issues (screenshots via create_image_upload_token)',
] as const

/** 完了条件を本文に書かれると受け入れ条件が使われないため、置き場所を伝える(create_ticket / update_ticket の description) */
export const ACCEPTANCE_CRITERIA_GUIDE =
  'Put completion conditions (acceptance criteria / definition of done / checklist) in acceptanceCriteria as one verifiable sentence per item, not in content.'

/** ACCEPTANCE_CRITERIA_GUIDE の instructions 向けの短い形(文字数の上限があるため) */
const TICKET_GUIDE =
  'Tickets: put completion conditions (definition of done / checklist) in acceptanceCriteria, one verifiable sentence each, not in content.'

/** get_ticket / get_board / get_agent_task に載るボードの前提(boardContext)と、ボードノートの索引の読み方 */
const BOARD_PREMISES = [
  'In get_ticket / get_board / get_agent_task (only when set):',
  '- boardContext: premises for every ticket on the board (repository, conventions, terms). Read and follow it before working.',
  '- boardKnowledge / boardMemory: indexes ("name: description") of notes shared by all board members. Read relevant ones with get_board_notes.',
]

/**
 * 得た情報の残し先。ボードノートは全員に共有されるので、個人・手元の環境のことはクライアント自身のメモリへ回させる。
 * 保存の規則の詳細は save_board_note の description に持たせる
 */
const NOTE_PLACEMENT = [
  'Where to keep what you learn:',
  '- Personal preferences or facts about your own machine / environment: your own memory, not board notes.',
  '- Learnings any member can use in any environment: memory via save_board_note (update, do not duplicate).',
]

/** ナレッジは利用者が管理するので、人の経路では依頼・同意があるときだけ書かせ、それ以外は提案させる */
const KNOWLEDGE_PLACEMENT = [
  '- Board-wide rules or procedures the user asks you to remember: knowledge (userApproved=true).',
  '- Confirmed memory or findings from checks / research worth keeping: propose making them knowledge. Change knowledge only with user consent.',
]

/** エージェントの経路はナレッジを変更できない(knowledgeDenial)ので、報告で提案させる */
const AGENT_KNOWLEDGE_PLACEMENT =
  '- Agents cannot change knowledge: propose confirmed memory or findings worth keeping as knowledge in your report.'

/** 指示の優先順位。手順が既定値であることを必ず添える */
const PRECEDENCE =
  'Precedence: user instructions > the ticket > project rules (CLAUDE.md / AGENTS.md, etc.) and boardContext > boardKnowledge > boardMemory > these default steps. ' +
  'When only asked to read a ticket or answer a question, do not comment or change the status.'

/**
 * エージェントの経路の優先順位とコメントの種別。人の経路は PRECEDENCE と手順(TICKET_WORKFLOW)で伝わるが、
 * エージェントには手順を載せないので、ここで補う
 */
const AGENT_PRECEDENCE =
  'Precedence: the ticket > boardContext > boardKnowledge > boardMemory. ' +
  'Comments with type=plan / type=report are shown separately from regular comments as a plan / a report.'

/**
 * `get_ticket` の応答に載せる手順。実行できる人(チケットを編集できる人の経路)にだけ返す。
 * エージェントはランナーの指示と get_agent_task の rule に従うので載せない(自動運用の流れと食い違わせない)。
 */
export const ticketWorkflowFor = (kind: ResourceAuth['kind'], canEdit: boolean): readonly string[] | undefined =>
  kind !== 'agent' && canEdit ? [...TICKET_WORKFLOW, PRECEDENCE] : undefined

/** 初期化応答に載せる instructions */
export const mcpInstructions = (kind: ResourceAuth['kind']): string => {
  const intro = [
    'devuntu is a kanban-style ticket management tool. ticketId accepts a display ID (e.g. ABC-42).',
    TICKET_GUIDE,
    '',
    ...BOARD_PREMISES,
    '',
    ...NOTE_PLACEMENT,
  ]
  if (kind === 'agent') {
    return [
      ...intro,
      AGENT_KNOWLEDGE_PLACEMENT,
      '',
      'In automated operation, follow the rule returned by get_agent_task and the runner instructions, and finally report the result with finish_agent_task.',
      'Link GitHub / GitLab branches, PRs (MRs) and commits with link_ticket_artifact to show their state and CI results on the ticket.',
      AGENT_PRECEDENCE,
    ].join('\n')
  }
  return [
    ...intro,
    ...KNOWLEDGE_PLACEMENT,
    '',
    'Default steps when working on a ticket (no need to confirm each time):',
    ...TICKET_WORKFLOW.map((step, i) => `${i + 1}. ${step}`),
    '',
    PRECEDENCE,
  ].join('\n')
}
