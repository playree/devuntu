/**
 * 自動運用の設定・カスタム指示・実行履歴の Server Action を組み立てる(サーバー専用)
 *
 * 管理者のエージェント詳細画面と承認者のエージェント承認画面で中身が同じなので、
 * 「誰が触ってよいか」(`authorize`)とログに出す名前だけを変えて同じ実装を使う。
 * 'use server' のファイルから `export const x = actions.x` の形で公開すること。
 */

import { safeAuthAction } from '../action/action-server'
import { scUUID } from '../schema/schema'
import { scSaveAgentRunner, scSaveAgentRunnerRule } from '../schema/schema-agent'
import {
  findAgentRunnerConfig,
  listAgentRuns,
  saveAgentRunnerConfig,
  saveAgentRunnerRuleValue,
} from './agent-runner-config'

type AgentRunnerActionOptions = {
  role: 'user' | 'admin'
  /** 各 Action の actionName */
  names: { get: string; save: string; saveRule: string; runs: string }
  /** 操作者がそのエージェントの設定を触ってよいか。NG なら throw する */
  authorize: (user: { id: string }, agentId: string) => Promise<void>
}

export const createAgentRunnerActions = ({ role, names, authorize }: AgentRunnerActionOptions) => ({
  /** 設定取得。行が無ければ null(= 未設定) */
  getAgentRunner: safeAuthAction
    .metadata({ actionName: names.get, role })
    .inputSchema(scUUID)
    .action(async ({ ctx: { user }, parsedInput: { id } }) => {
      await authorize(user, id)

      return await findAgentRunnerConfig(id)
    }),

  /** 設定保存(無ければ作成)。ランナーの自己申告(ホスト名・版)はここでは触らない */
  saveAgentRunner: safeAuthAction
    .metadata({ actionName: names.save, role })
    .inputSchema(scSaveAgentRunner)
    .action(async ({ ctx: { user }, parsedInput }) => {
      await authorize(user, parsedInput.userId)

      await saveAgentRunnerConfig(parsedInput)
      return { userId: parsedInput.userId }
    }),

  /** カスタム指示(ルール)単体の保存 */
  saveAgentRunnerRule: safeAuthAction
    .metadata({ actionName: names.saveRule, role })
    .inputSchema(scSaveAgentRunnerRule)
    .action(async ({ ctx: { user }, parsedInput: { userId, rule } }) => {
      await authorize(user, userId)

      await saveAgentRunnerRuleValue(userId, rule)
      return { userId }
    }),

  /** 実行履歴。件数が増え続けるので新しい順に上限まで返す */
  getAgentRuns: safeAuthAction
    .metadata({ actionName: names.runs, role })
    .inputSchema(scUUID)
    .action(async ({ ctx: { user }, parsedInput: { id } }) => {
      await authorize(user, id)

      return await listAgentRuns(id)
    }),
})
