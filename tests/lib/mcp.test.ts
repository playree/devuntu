/**
 * MCP クライアントへ貼り付ける登録コマンド。
 *
 * 発行画面がそのまま表示してユーザーがコピーする文字列なので、スコープの出し分けと
 * URL の組み立てを固定する。
 */

import { AGENT_TOKEN_ENV, AGENT_TOKEN_REF } from '@/lib/agent/agent'
import { MCP_TOKEN_ENV, mcpAddCommand, mcpCodexAddCommand, mcpTokenExportCommand } from '@/lib/mcp/mcp'
import { describe, expect, it } from 'vitest'

describe('mcpAddCommand', () => {
  it('user スコープでは --scope user を付ける(ユーザーのトークン用)', () => {
    expect(mcpAddCommand('https://devuntu.example', 'devuntu_pat_x', 'devuntu', 'user')).toBe(
      'claude mcp add --scope user --transport http devuntu https://devuntu.example/api/mcp' +
        " --header 'Authorization: Bearer devuntu_pat_x'",
    )
  })

  it('local スコープでは --scope を付けない(CLI の既定なので)', () => {
    expect(mcpAddCommand('https://devuntu.example', 'devuntu_agent_x', 'devuntu-agent', 'local')).toBe(
      'claude mcp add --transport http devuntu-agent https://devuntu.example/api/mcp' +
        " --header 'Authorization: Bearer devuntu_agent_x'",
    )
  })

  it('環境変数の参照はシェルに展開させない(シングルクォート)', () => {
    expect(mcpAddCommand('https://devuntu.example', AGENT_TOKEN_REF, 'devuntu-agent', 'project')).toBe(
      'claude mcp add --scope project --transport http devuntu-agent https://devuntu.example/api/mcp' +
        " --header 'Authorization: Bearer ${DEVUNTU_AGENT_TOKEN}'",
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

describe('mcpCodexAddCommand', () => {
  it('トークンそのものではなく環境変数名を渡す', () => {
    const command = mcpCodexAddCommand('https://devuntu.example', 'devuntu-agent', AGENT_TOKEN_ENV)
    expect(command).toBe(
      'codex mcp add --url https://devuntu.example/api/mcp --bearer-token-env-var DEVUNTU_AGENT_TOKEN devuntu-agent',
    )
  })

  it('ユーザーのトークンでは人間用の環境変数名を渡す', () => {
    const command = mcpCodexAddCommand('https://devuntu.example', 'devuntu', MCP_TOKEN_ENV)
    expect(command).toBe(
      'codex mcp add --url https://devuntu.example/api/mcp --bearer-token-env-var DEVUNTU_MCP_TOKEN devuntu',
    )
  })
})

describe('mcpTokenExportCommand', () => {
  it('シェルへ貼れる export 行を返す', () => {
    expect(mcpTokenExportCommand(MCP_TOKEN_ENV, 'devuntu_pat_x')).toBe("export DEVUNTU_MCP_TOKEN='devuntu_pat_x'")
  })
})
