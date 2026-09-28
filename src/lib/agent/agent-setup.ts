/**
 * 自動運用(Devuntu Agent)のセットアップ手順(サーバー専用)
 *
 * MCP ツール `get_agent_setup_guide` が返す本文。利用者のマシンで CLI に
 * そのまま実行させられる形にしてある。ランナー本体は `public/agent/devuntu_agent.py` に
 * 置いてあり、この手順から `curl` で取得する(サーバーと同じ版が必ず落ちてくる)。
 *
 * 本文の Markdown は `public/agent/agent-setup-guide.md` にあり、ここでは
 * プレースホルダー(`{{baseUrl}}` など)の置換と、選ばれた CLI の記述だけを残す絞り込みを行う。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeUrl } from '../server-utils'
import {
  AGENT_CLI_KINDS,
  AGENT_CLI_LABEL,
  AGENT_POLL_INTERVAL_OPTIONS,
  type AgentCliKind,
  DEFAULT_POLL_INTERVAL_SEC,
} from './agent'

/** ランナー本体の配布先。`public/` 配下なので認証は要らない(秘密情報を含まないため) */
export const AGENT_SCRIPT_PATH = '/agent/devuntu_agent.py'

/** セットアップ手順の Markdown 本文。`public/` 配下なので standalone ビルドでも確実に配置される */
const GUIDE_TEMPLATE_PATH = join(process.cwd(), 'public/agent/agent-setup-guide.md')

/** CLI 別の記述を囲むマーカー。HTML コメントなので素の Markdown を読むときには目に入らない */
const CLI_BLOCK_START = /^<!-- cli:(.+) -->$/
const CLI_BLOCK_END = '<!-- /cli -->'

/**
 * 選んだ CLI のブロックだけを残す。もう一方のコマンドは本文に一切残さない
 * (残すと読み手がどちらを実行すべきか迷い、結局既定側の手順で進んでしまう)。
 *
 * マーカーの綴り違いや閉じ忘れは黙って全消しになりかねないので、テストで気付けるよう例外にする。
 */
const pickCliBlocks = (markdown: string, cli: AgentCliKind): string => {
  const kinds: readonly string[] = AGENT_CLI_KINDS
  const picked: string[] = []
  let current: string | null = null

  markdown.split('\n').forEach((line, index) => {
    const started = CLI_BLOCK_START.exec(line)
    if (started) {
      if (current) {
        throw new Error(`Nested CLI block (line ${index + 1})`)
      }
      if (!kinds.includes(started[1])) {
        throw new Error(`Unknown CLI kind ${started[1]} (line ${index + 1})`)
      }
      current = started[1]
      return
    }
    if (line === CLI_BLOCK_END) {
      if (!current) {
        throw new Error(`No matching start marker (line ${index + 1})`)
      }
      current = null
      return
    }
    if (!current || current === cli) {
      picked.push(line)
    }
  })

  if (current) {
    throw new Error(`Unclosed CLI block (cli:${current})`)
  }
  // ブロックが落ちた箇所で空行が続くことがあるため、段落の区切りに揃え直す
  return picked.join('\n').replaceAll(/\n{3,}/g, '\n\n')
}

export const agentSetupGuide = (cli: AgentCliKind): string => {
  const baseUrl = makeUrl('/').toString().replace(/\/$/, '')
  const scriptUrl = makeUrl(AGENT_SCRIPT_PATH).toString()
  const mcpUrl = makeUrl('/api/mcp').toString()
  const intervalMinutes = String(DEFAULT_POLL_INTERVAL_SEC / 60)
  const pollIntervalOptions = AGENT_POLL_INTERVAL_OPTIONS.map((sec) => `${sec / 60} min`).join(' / ')

  return pickCliBlocks(readFileSync(GUIDE_TEMPLATE_PATH, 'utf-8'), cli)
    .replaceAll('{{baseUrl}}', baseUrl)
    .replaceAll('{{scriptUrl}}', scriptUrl)
    .replaceAll('{{mcpUrl}}', mcpUrl)
    .replaceAll('{{intervalMinutes}}', intervalMinutes)
    .replaceAll('{{pollIntervalOptions}}', pollIntervalOptions)
    .replaceAll('{{cliKind}}', cli)
    .replaceAll('{{cliLabel}}', AGENT_CLI_LABEL[cli])
}

/**
 * CLI が指定されずに呼ばれたときの応答。
 *
 * 手順を返してしまうと、呼び出し側は自分が動いている CLI(または本文で先に出てくる方)で
 * そのまま進めてしまう。どちらで動かすかは利用者が決めることなので、選ばせるまで手順は出さない。
 */
export const agentSetupCliPrompt = (): string =>
  [
    'Ask the user which CLI should run the agent, then call this tool again with `cli`.',
    '',
    ...AGENT_CLI_KINDS.map((kind) => `- \`${kind}\`: ${AGENT_CLI_LABEL[kind]} (the \`${kind}\` command)`),
    '',
    'This response does not contain the steps. Do not choose on behalf of the user',
    '(the CLI you are running in may differ from the CLI the user wants the agent to use).',
  ].join('\n')
