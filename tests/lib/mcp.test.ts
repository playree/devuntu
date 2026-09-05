/**
 * MCP クライアントへ貼り付ける登録コマンド。
 *
 * 発行画面がそのまま表示してユーザーがコピーする文字列なので、スコープの出し分けと
 * URL の組み立てを固定する。
 */

import { mcpAddCommand } from '@/lib/mcp/mcp'
import { describe, expect, it } from 'vitest'

describe('mcpAddCommand', () => {
  it('user スコープでは --scope user を付ける(ユーザーのトークン用)', () => {
    expect(mcpAddCommand('https://devuntu.example', 'devuntu_pat_x', 'devuntu', 'user')).toBe(
      'claude mcp add --scope user --transport http devuntu https://devuntu.example/api/mcp' +
        ' --header "Authorization: Bearer devuntu_pat_x"',
    )
  })

  it('local スコープでは --scope を付けない(CLI の既定なので)', () => {
    expect(mcpAddCommand('https://devuntu.example', 'devuntu_agent_x', 'devuntu-agent', 'local')).toBe(
      'claude mcp add --transport http devuntu-agent https://devuntu.example/api/mcp' +
        ' --header "Authorization: Bearer devuntu_agent_x"',
    )
  })

  it('baseUrl の末尾スラッシュやパスがあっても /api/mcp を落とさない', () => {
    expect(mcpAddCommand('https://devuntu.example/', 't', 'devuntu', 'user')).toContain(
      'https://devuntu.example/api/mcp',
    )
    expect(mcpAddCommand('https://example.com/devuntu', 't', 'devuntu', 'user')).toContain(
      'https://example.com/devuntu/api/mcp',
    )
  })
})
