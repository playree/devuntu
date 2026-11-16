/**
 * スキルのファイルの未認証配信(`/api/skills/<name>/<path>`)
 */

import { GET } from '@/app/api/skills/[name]/[...path]/route'
import { agentSkill } from 'markdown-design-doc-viewer-embed/skill'
import { describe, expect, it } from 'vitest'

const call = (name: string, path: string[]) =>
  GET(new Request('http://localhost:3000'), { params: Promise.resolve({ name, path }) })

describe('GET /api/skills/[name]/[...path]', () => {
  it('同梱のスキルのファイルを Markdown として返す', async () => {
    const res = await call('markdown-design-doc', ['SKILL.md'])

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    // 依存パッケージを上げた直後に前の版が混ざらないよう、キャッシュさせない
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
    expect(await res.text()).toBe(agentSkill.files['SKILL.md'])
  })

  it('フォルダの下のファイルも返す', async () => {
    const res = await call('markdown-design-doc', ['references', 'cli.md'])

    expect(res.status).toBe(200)
    expect(await res.text()).toBe(agentSkill.files['references/cli.md'])
  })

  it('未知のスキル・無いファイルは 404', async () => {
    expect((await call('unknown-skill', ['SKILL.md'])).status).toBe(404)
    expect((await call('markdown-design-doc', ['..', 'package.json'])).status).toBe(404)
  })
})
