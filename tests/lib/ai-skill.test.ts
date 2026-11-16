/**
 * AI ツールのスキルの配布と、インストール手順の本文
 */

import { findAiSkillFile, skillInstallGuide } from '@/lib/ai-skill'
import designDocViewerPkg from 'markdown-design-doc-viewer-embed/package.json'
import { agentSkill } from 'markdown-design-doc-viewer-embed/skill'
import { describe, expect, it } from 'vitest'

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u

const BASE = 'http://localhost:3000/api/skills/markdown-design-doc'

describe('findAiSkillFile', () => {
  it('同梱のスキルのファイルを、そのフォルダからのパスで返す', () => {
    expect(findAiSkillFile('markdown-design-doc', 'SKILL.md')).toBe(agentSkill.files['SKILL.md'])
    expect(findAiSkillFile('markdown-design-doc', 'references/cli.md')).toBe(agentSkill.files['references/cli.md'])
  })

  it('未知のスキル・無いパス・フォルダの外を指すパスは返さない', () => {
    expect(findAiSkillFile('unknown-skill', 'SKILL.md')).toBeUndefined()
    expect(findAiSkillFile('markdown-design-doc', 'missing.md')).toBeUndefined()
    expect(findAiSkillFile('markdown-design-doc', '../package.json')).toBeUndefined()
    expect(findAiSkillFile('markdown-design-doc', 'references')).toBeUndefined()
    expect(findAiSkillFile('markdown-design-doc', 'constructor')).toBeUndefined()
  })
})

describe('skillInstallGuide', () => {
  const guide = skillInstallGuide('markdown-design-doc')
  const sh = guide.slice(guide.indexOf('```sh'), guide.indexOf('```powershell'))
  const ps = guide.slice(guide.indexOf('```powershell'))

  it('同梱のすべてのファイルを、このサーバーの URL から取得させる', () => {
    for (const path of Object.keys(agentSkill.files)) {
      expect(sh).toContain(`curl -fsSL -o "$stage/new/${path}" "${BASE}/${path}"`)
      expect(ps).toContain(`Invoke-WebRequest -UseBasicParsing -Uri "${BASE}/${path}"`)
    }
  })

  it('GitHub の zip は、ファイルを書けないクライアント向けの案内にだけ出す', () => {
    const zipUrl =
      'https://github.com/playree/markdown-design-doc-viewer/releases/download/' +
      `v${designDocViewerPkg.version}/markdown-design-doc-skill.zip`
    expect(guide).toContain(`give the user ${zipUrl}`)
    expect(sh).not.toContain('github.com')
    expect(ps).not.toContain('github.com')
  })

  it('既存のコピーは revision で新旧を判定させ、新しいものは置き換えさせない', () => {
    expect(guide).toContain(`(revision ${agentSkill.revision})`)
    expect(guide).toContain(`greater than ${agentSkill.revision}: it is newer than this one. Do not replace it`)
  })

  it('失敗したら止め、全ファイルを取得して確かめてから既存のフォルダと入れ替え、入れ替えに失敗したら戻す', () => {
    expect(sh).toContain('set -e')
    expect(sh).toContain('stage="$(mktemp -d "$dest/.markdown-design-doc-XXXXXX")"')
    expect(sh.indexOf('test -f "$stage/new/SKILL.md"')).toBeLessThan(
      sh.indexOf('mv "$dest/markdown-design-doc" "$stage/old"'),
    )
    expect(sh).toContain('mv "$stage/old" "$dest/markdown-design-doc"')
    expect(ps).toContain("$ErrorActionPreference = 'Stop'")
    expect(ps.indexOf('SKILL.md was not downloaded')).toBeLessThan(ps.indexOf('Move-Item "$dest\\markdown-design-doc"'))
    expect(ps).toContain('Move-Item "$stage\\old" "$dest\\markdown-design-doc"')
  })

  it('revision は整数として比べさせる(front matter では引用符付きのため)', () => {
    expect(guide).toContain(`compare it as an integer (it is written quoted, as \`"${agentSkill.revision}"\`)`)
  })

  it('同梱のファイルのパスは、シェルの引用符の中で展開されない文字だけでできている', () => {
    for (const path of Object.keys(agentSkill.files)) {
      expect(path).toMatch(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/)
    }
  })

  it('入れる場所は利用者に確かめさせる', () => {
    expect(guide).toContain('Ask the user before writing anything')
    expect(guide).toContain('`$HOME/.claude/skills`')
  })

  it('英語で書く', () => {
    expect(guide).not.toMatch(JAPANESE)
  })
})
