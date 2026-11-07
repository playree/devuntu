/**
 * セットアップ手順の組み立て。
 *
 * 手順は利用者がそのまま実行するので、選ばなかった CLI のコマンドが 1 つでも残っていると
 * 取り違えて実行されてしまう。ここでは「選んだ側だけが残ること」を両方向から確かめる。
 */

import { agentSetupCliPrompt, agentSetupGuide } from '@/lib/agent/agent-setup'
import { describe, expect, it, vi } from 'vitest'

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

  it('ランナーの timeout_sec はサーバーの時間切れ(既定60分)より短い値で書く', () => {
    ;[claude, codex, opencode].forEach((guide) => {
      expect(guide).toContain('"timeout_sec": 3300')
      expect(guide).toContain('records a run as failed after 60 minutes')
    })
  })

  it('AGENT_RUN_TIMEOUT_MIN を変えると timeout_sec も追従する', () => {
    vi.stubEnv('AGENT_RUN_TIMEOUT_MIN', '210')
    const guide = agentSetupGuide('opencode')
    vi.unstubAllEnvs()

    expect(guide).toContain('"timeout_sec": 12300')
    expect(guide).toContain('records a run as failed after 210 minutes')
    expect(guide).toContain('automatically becomes failed after 210 minutes')
  })

  it('手順と CLI 未指定時の応答は英語で返す', () => {
    ;[claude, codex, opencode, agentSetupCliPrompt()].forEach((text) => {
      expect(text).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u)
    })
  })

  it('既存のエージェントを確認し、上書きか新しい作業ディレクトリかを利用者に選ばせる', () => {
    ;[claude, codex, opencode].forEach((guide) => {
      expect(guide).toContain('crontab -l 2>/dev/null | grep -F devuntu_agent.py')
      expect(guide).toContain('~/devuntu-agent-work*/.devuntu-agent/config.json')
      expect(guide).toContain('**Overwrite**')
      expect(guide).toContain('**New working directory**')
      expect(guide.indexOf('### Check for an existing agent')).toBeLessThan(
        guide.indexOf('mkdir -p ~/devuntu-agent-work'),
      )
    })
  })

  it('同じ作業ディレクトリの cron 行が既にあれば追加しない', () => {
    ;[claude, codex, opencode].forEach((guide) => {
      expect(guide).toContain(
        "crontab -l 2>/dev/null | grep -v '^[[:space:]]*#' | grep -qF '~/devuntu-agent-work/.devuntu-agent/devuntu_agent.py poll' || \\",
      )
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
