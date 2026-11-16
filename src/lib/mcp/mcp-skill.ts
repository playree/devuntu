/**
 * AI ツールへのスキルのインストール手順を返す MCP ツール(サーバー専用)
 *
 * 手順の本文とスキルの配布は `ai-skill.ts`。入れる場所を利用者に確かめさせるので、人の経路にだけ登録する。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SKILL_NAMES, skillInstallGuide } from '../ai-skill'
import { TOOL_ANNOTATIONS } from './mcp'

export const registerSkillTools = (server: McpServer) => {
  server.registerTool(
    'get_skill_install_guide',
    {
      title: 'Skill install guide',
      annotations: TOOL_ANNOTATIONS.readOnly,
      description:
        'Returns the steps to install an Agent Skill for your AI tool on the user machine (download its files from this server into a skills folder). ' +
        'markdown-design-doc teaches the format of design doc pages in the Wiki. Install it only when the user asks for it or agrees',
      inputSchema: z.strictObject({
        skill: z.enum(SKILL_NAMES).describe('Skill to install'),
      }),
    },
    async ({ skill }) => ({ content: [{ type: 'text' as const, text: skillInstallGuide(skill) }] }),
  )
}
