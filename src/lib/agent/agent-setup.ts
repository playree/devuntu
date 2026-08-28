/**
 * 自動運用(Devuntu Agent)のセットアップ手順(サーバー専用)
 *
 * MCP ツール `get_agent_setup_guide` が返す本文。利用者のマシンで Claude Code に
 * そのまま実行させられる形にしてある。ランナー本体は `public/agent/devuntu_agent.py` に
 * 置いてあり、この手順から `curl` で取得する(サーバーと同じ版が必ず落ちてくる)。
 *
 * 本文の Markdown は `public/agent/agent-setup-guide.md` にあり、ここでは
 * プレースホルダー(`{{baseUrl}}` など)を実際の値に置換するだけ。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeUrl } from '../server-utils'
import { AGENT_POLL_INTERVAL_OPTIONS, DEFAULT_POLL_INTERVAL_SEC } from './agent'

/** ランナー本体の配布先。`public/` 配下なので認証は要らない(秘密情報を含まないため) */
export const AGENT_SCRIPT_PATH = '/agent/devuntu_agent.py'

/** セットアップ手順の Markdown 本文。`public/` 配下なので standalone ビルドでも確実に配置される */
const GUIDE_TEMPLATE_PATH = join(process.cwd(), 'public/agent/agent-setup-guide.md')

export const agentSetupGuide = (): string => {
  const baseUrl = makeUrl('/').toString().replace(/\/$/, '')
  const scriptUrl = makeUrl(AGENT_SCRIPT_PATH).toString()
  const mcpUrl = makeUrl('/api/mcp').toString()
  const intervalMinutes = String(DEFAULT_POLL_INTERVAL_SEC / 60)
  const pollIntervalOptions = AGENT_POLL_INTERVAL_OPTIONS.map((sec) => `${sec / 60}分`).join(' / ')

  return readFileSync(GUIDE_TEMPLATE_PATH, 'utf-8')
    .replaceAll('{{baseUrl}}', baseUrl)
    .replaceAll('{{scriptUrl}}', scriptUrl)
    .replaceAll('{{mcpUrl}}', mcpUrl)
    .replaceAll('{{intervalMinutes}}', intervalMinutes)
    .replaceAll('{{pollIntervalOptions}}', pollIntervalOptions)
}
