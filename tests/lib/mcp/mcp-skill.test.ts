/**
 * スキルのインストール手順を返す MCP ツール。
 *
 * サーバーは zip を取得しないので、返す手順の中身(URL・展開の手順)だけを見る。
 * 全経路に登録されることは mcp-server.test.ts の一覧と注釈の検証で見ている。
 */

import { registerSkillTools, skillInstallGuide } from '@/lib/mcp/mcp-skill'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import designDocViewerPkg from 'markdown-design-doc-viewer-embed/package.json'
import { describe, expect, it } from 'vitest'
import { connectMcpServer } from '../../helpers/mcp-client'

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u

const connect = () => {
  const server = new McpServer({ name: 'test', version: '1.0.0' })
  registerSkillTools(server)
  return connectMcpServer(server)
}

const ZIP_URL =
  'https://github.com/playree/markdown-design-doc-viewer/releases/download/' +
  `v${designDocViewerPkg.version}/markdown-design-doc-skill.zip`

describe('skillInstallGuide', () => {
  const guide = skillInstallGuide('markdown-design-doc')

  it('zip は latest ではなく、表示に使っている embed のバージョンのタグを指す', () => {
    expect(guide).toContain(ZIP_URL)
    expect(guide).not.toContain('releases/latest')
  })

  it('macOS / Linux と Windows の両方の取得・展開の手順があり、失敗したら止める', () => {
    expect(guide).toContain(`curl -fsSL -o "$tmp/skill.zip" "${ZIP_URL}"`)
    expect(guide).toContain('set -e')
    expect(guide).toContain('mktemp -d')
    expect(guide).toContain(`Invoke-WebRequest -UseBasicParsing -Uri "${ZIP_URL}"`)
    expect(guide).toContain("$ErrorActionPreference = 'Stop'")
    expect(guide).toContain('Expand-Archive')
  })

  it('既存のスキルは、新しいものを展開して確かめた後で置き換える', () => {
    const sh = guide.slice(guide.indexOf('```sh'), guide.indexOf('```powershell'))
    expect(sh.indexOf('test -f "$tmp/markdown-design-doc/SKILL.md"')).toBeLessThan(sh.indexOf('rm -rf "$dest/'))
    const ps = guide.slice(guide.indexOf('```powershell'))
    expect(ps.indexOf('SKILL.md is not in the zip')).toBeLessThan(ps.indexOf('Remove-Item -Recurse -Force "$dest'))
  })

  it('入れる場所は利用者に確かめさせ、ファイルを書けないクライアントには zip を渡させる', () => {
    expect(guide).toContain('Ask the user before writing anything')
    expect(guide).toContain('`$HOME/.claude/skills`')
    expect(guide).toContain('upload the zip')
  })

  it('英語で書く', () => {
    expect(guide).not.toMatch(JAPANESE)
  })
})

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
