/**
 * スキルのインストール手順を返す MCP ツール。
 *
 * 手順の中身は ai-skill.test.ts で、人の経路にだけ登録されることは mcp-server.test.ts で見ている。
 */

import { skillInstallGuide } from '@/lib/ai-skill'
import { registerSkillTools } from '@/lib/mcp/mcp-skill'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { connectMcpServer } from '../../helpers/mcp-client'

const connect = () => {
  const server = new McpServer({ name: 'test', version: '1.0.0' })
  registerSkillTools(server)
  return connectMcpServer(server)
}

describe('get_skill_install_guide', () => {
  it('指定したスキルの手順を text で返す', async () => {
    const result = await (
      await connect()
    ).callTool({
      name: 'get_skill_install_guide',
      arguments: { skill: 'markdown-design-doc' },
    })
    const text = (result.content as { text: string }[])[0].text

    expect(result.isError).toBeFalsy()
    expect(text).toBe(skillInstallGuide('markdown-design-doc'))
  })

  it('未知のスキルは入力エラーにする', async () => {
    const result = await (
      await connect()
    ).callTool({
      name: 'get_skill_install_guide',
      arguments: { skill: 'unknown-skill' },
    })

    expect(result.isError).toBe(true)
  })
})
