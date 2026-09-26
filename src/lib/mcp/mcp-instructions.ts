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
  '着手時: update_ticket で status を doing にする(既に doing / done なら変えない)',
  '方針を立てたら: add_ticket_comment に type=plan で投稿する',
  '利用者への確認事項: type を付けない通常コメントで投稿する',
  'ブランチ / プルリクエスト / コミットを作ったら: link_ticket_artifact で URL を紐付ける(ブランチ名を feature/<表示ID> にすると、ボードに対応付けたリポジトリでは自動で紐付く)',
  '完了時: add_ticket_comment に type=report で、何をしたか・確認結果・残課題を報告する(スクリーンショットは create_image_upload_token で添付する)',
] as const

/** 手順より優先するもの。既定値であることを必ず添える */
const PRECEDENCE =
  '利用者の指示やプロジェクトのルール(CLAUDE.md / AGENTS.md など)に別の定めがあれば、そちらに従う。' +
  'チケットを読むだけ・質問に答えるだけの依頼では、コメントの投稿もステータスの変更もしない。'

/**
 * `get_ticket` の応答に載せる手順。実行できる人(チケットを編集できる人の経路)にだけ返す。
 * エージェントはランナーの指示と get_agent_task の rule に従うので載せない(自動運用の流れと食い違わせない)。
 */
export const ticketWorkflowFor = (kind: ResourceAuth['kind'], canEdit: boolean): readonly string[] | undefined =>
  kind !== 'agent' && canEdit ? [...TICKET_WORKFLOW, PRECEDENCE] : undefined

/** 初期化応答に載せる instructions */
export const mcpInstructions = (kind: ResourceAuth['kind']): string => {
  const common = [
    'devuntu はかんばん形式のチケット管理ツール。ticketId には表示ID(例: ABC-42)を使える。',
    'コメントの種別: type=plan は対応方針、type=report は対応報告で、詳細画面で通常コメントと区別して表示される。',
    'GitHub のブランチ / プルリクエスト / コミットは link_ticket_artifact でチケットに紐付けると、状態と CI の結果がチケットに表示される。',
  ]
  if (kind === 'agent') {
    return [
      ...common,
      '自動運用では、get_agent_task が返す rule とランナーの指示に従い、最後に finish_agent_task で結果を報告する。',
    ].join('\n')
  }
  return [
    ...common,
    '',
    'チケットを入力に作業するときは、次の手順を既定とする(都度の確認は不要)。',
    ...TICKET_WORKFLOW.map((step, i) => `${i + 1}. ${step}`),
    '',
    PRECEDENCE,
  ].join('\n')
}
