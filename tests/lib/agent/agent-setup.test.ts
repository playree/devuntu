/**
 * セットアップ手順の組み立て。
 *
 * 手順は利用者がそのまま実行するので、選ばなかった CLI のコマンドが 1 つでも残っていると
 * 取り違えて実行されてしまう。ここでは「選んだ側だけが残ること」を両方向から確かめる。
 */

import { agentSetupCliPrompt, agentSetupGuide } from '@/lib/agent/agent-setup'
import { describe, expect, it } from 'vitest'

const claude = agentSetupGuide('claude')
const codex = agentSetupGuide('codex')

describe('agentSetupGuide', () => {
  it('このサーバーのランナー配布先と MCP のURLを埋めて返す', () => {
    expect(claude).toContain('http://localhost:3000/agent/devuntu_agent.py')
    expect(claude).toContain('http://localhost:3000/api/mcp')
  })

  it('プレースホルダーとマーカーを残さない', () => {
    ;[claude, codex].forEach((guide) => {
      expect(guide).not.toContain('{{')
      expect(guide).not.toContain('<!-- cli:')
      expect(guide).not.toContain('<!-- /cli -->')
      expect(guide).not.toMatch(/\n{3}/)
    })
  })

  it('claude を選ぶと codex のコマンドが残らない', () => {
    expect(claude).toContain('claude mcp add --transport http devuntu-agent')
    expect(claude).toContain('"kind": "claude"')
    expect(claude).not.toContain('codex')
    expect(claude).not.toContain('bearer_token_env_var')
  })

  it('codex を選ぶと claude のコマンドが残らない', () => {
    expect(codex).toContain('bearer_token_env_var = "DEVUNTU_AGENT_TOKEN"')
    expect(codex).toContain('"kind": "codex"')
    expect(codex).not.toContain('claude')
    expect(codex).not.toContain('.mcp.json')
  })
})

describe('agentSetupCliPrompt', () => {
  it('手順ではなく、CLI を利用者に確認するよう促す', () => {
    const prompt = agentSetupCliPrompt()

    expect(prompt).not.toContain('# Devuntu Agent のセットアップ')
    expect(prompt).toContain('利用者に確認')
    expect(prompt).toContain('Claude Code')
    expect(prompt).toContain('Codex CLI')
  })
})
