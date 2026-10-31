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
const opencode = agentSetupGuide('opencode')

describe('agentSetupGuide', () => {
  it('このサーバーのランナー配布先と MCP のURLを埋めて返す', () => {
    expect(claude).toContain('http://localhost:3000/agent/devuntu_agent.py')
    expect(claude).toContain('http://localhost:3000/api/mcp')
  })

  it('プレースホルダーとマーカーを残さない', () => {
    ;[claude, codex, opencode].forEach((guide) => {
      expect(guide).not.toContain('{{')
      expect(guide).not.toContain('<!-- cli:')
      expect(guide).not.toContain('<!-- /cli -->')
      expect(guide).not.toMatch(/\n{3}/)
    })
  })

  it('手順と CLI 未指定時の応答は英語で返す', () => {
    ;[claude, codex, opencode, agentSetupCliPrompt()].forEach((text) => {
      expect(text).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u)
    })
  })

  it('claude を選ぶと他の CLI のコマンドが残らない', () => {
    expect(claude).toContain('claude mcp add --transport http devuntu-agent')
    expect(claude).toContain('"kind": "claude"')
    expect(claude).not.toContain('codex')
    expect(claude).not.toContain('bearer_token_env_var')
    expect(claude).not.toContain('opencode')
  })

  it('codex を選ぶと他の CLI のコマンドが残らない', () => {
    expect(codex).toContain('bearer_token_env_var = "DEVUNTU_AGENT_TOKEN"')
    expect(codex).toContain('"kind": "codex"')
    expect(codex).not.toContain('claude')
    expect(codex).not.toContain('.mcp.json')
    expect(codex).not.toContain('opencode')
  })

  it('opencode を選ぶと他の CLI のコマンドが残らない', () => {
    expect(opencode).toContain("--header 'Authorization=Bearer {env:DEVUNTU_AGENT_TOKEN}'")
    expect(opencode).toContain('"kind": "opencode"')
    expect(opencode).not.toContain('claude')
    expect(opencode).not.toContain('.mcp.json')
    expect(opencode).not.toContain('codex')
  })
})

describe('agentSetupCliPrompt', () => {
  it('手順ではなく、CLI を利用者に確認するよう促す', () => {
    const prompt = agentSetupCliPrompt()

    expect(prompt).not.toContain('# Devuntu Agent Setup')
    expect(prompt).toContain('Ask the user')
    expect(prompt).toContain('Claude Code')
    expect(prompt).toContain('Codex CLI')
    expect(prompt).toContain('OpenCode')
  })
})
