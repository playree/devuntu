/**
 * AI ツールへのスキルのインストール手順を返す MCP ツール(サーバー専用)
 *
 * スキルの本体は Devuntu に持たず、配布元(GitHub のリリース)の zip を AI ツール側で取得・展開させる。
 * zip の URL は `releases/latest` ではなく、Wiki の表示に使っている embed のバージョンのタグに固定する。
 * ビューアが描ける記法とスキルが教える記法をそろえるためと、同じリポジトリの Desktop app のリリースが
 * Latest になると `latest/download` の zip が見つからなくなるため。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import designDocViewerPkg from 'markdown-design-doc-viewer-embed/package.json'
import { z } from 'zod'
import { TOOL_ANNOTATIONS } from './mcp'

export const SKILL_NAMES = ['markdown-design-doc'] as const
export type SkillName = (typeof SKILL_NAMES)[number]

type SkillSource = {
  /** スキルが何をするかの一文(利用者への説明に使わせる) */
  purpose: string
  version: string
  zipUrl: string
}

const SKILL_SOURCES: Record<SkillName, SkillSource> = {
  'markdown-design-doc': {
    purpose:
      'write design documents in the Markdown Design Doc Viewer format (diagrams linked to the step headings after them), ' +
      'the format of design doc pages in the Devuntu Wiki',
    version: designDocViewerPkg.version,
    zipUrl:
      'https://github.com/playree/markdown-design-doc-viewer/releases/download/' +
      `v${designDocViewerPkg.version}/markdown-design-doc-skill.zip`,
  },
}

/** スキルのインストール手順(Markdown)。zip の中は `<name>/` フォルダ1つなので、スキルのフォルダの親へ展開させる */
export const skillInstallGuide = (name: SkillName) => {
  const { purpose, version, zipUrl } = SKILL_SOURCES[name]
  return `# Install the ${name} skill (v${version})

The Agent Skill \`${name}\` lets you ${purpose}.

Zip: ${zipUrl}
It contains one folder \`${name}/\` with \`SKILL.md\` in it.

## 1. Ask the user where to install it

Ask the user before writing anything. Offer the skills folders of the tool you are running in:

| Tool | For all projects | For this project (commit it to share it with the team) |
|---|---|---|
| Claude Code | \`$HOME/.claude/skills\` | \`<project root>/.claude/skills\` |
| Codex | \`$HOME/.agents/skills\` | \`<project root>/.agents/skills\` |
| OpenCode | \`$HOME/.config/opencode/skills\` | \`<project root>/.opencode/skills\` |
| Other tools | the skills folder of the tool | |

If you cannot write files on the user's machine (claude.ai, Claude Desktop and the like), do not install it yourself:
give the user the zip URL above and ask them to upload the zip in the skills settings of the tool.

If \`<skills folder>/${name}\` already exists, tell the user that it will be replaced by v${version} (changes made to its files are lost), and go on only if they agree.

## 2. Download and extract the zip

Run the block for the user's OS as one command, with \`<skills folder>\` replaced by the chosen folder
(an absolute path or one starting with \`$HOME\`, not \`~\`, which is not expanded inside quotes).
It stops at the first error and replaces the existing folder only after the new one is extracted and checked.

macOS / Linux:

\`\`\`sh
(
  set -e
  dest="<skills folder>"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/skill.zip" "${zipUrl}"
  unzip -q "$tmp/skill.zip" -d "$tmp"
  test -f "$tmp/${name}/SKILL.md"
  mkdir -p "$dest"
  rm -rf "$dest/${name}"
  mv "$tmp/${name}" "$dest/${name}"
)
\`\`\`

Windows (PowerShell):

\`\`\`powershell
& {
  $ErrorActionPreference = 'Stop'
  $dest = "<skills folder>"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "${zipUrl}" -OutFile "$tmp\\skill.zip"
    Expand-Archive -Path "$tmp\\skill.zip" -DestinationPath $tmp
    if (-not (Test-Path "$tmp\\${name}\\SKILL.md")) { throw 'SKILL.md is not in the zip' }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    if (Test-Path "$dest\\${name}") { Remove-Item -Recurse -Force "$dest\\${name}" }
    Move-Item "$tmp\\${name}" "$dest\\${name}"
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
\`\`\`

If it fails, tell the user the error. The existing skill, if any, is left as it was unless the failure is in the last two steps.

## 3. Check it

- \`<skills folder>/${name}/SKILL.md\` exists
- Tell the user where it was installed. Some tools load skills only when a session starts, so it may take effect from the next session
`
}

export const registerSkillTools = (server: McpServer) => {
  server.registerTool(
    'get_skill_install_guide',
    {
      title: 'Skill install guide',
      annotations: TOOL_ANNOTATIONS.readOnly,
      description:
        'Returns the steps to install an Agent Skill for your AI tool on the user machine (download and extract its zip into a skills folder). ' +
        'markdown-design-doc teaches the format of design doc pages in the Wiki. Install it only when the user asks for it or agrees',
      inputSchema: z.strictObject({
        skill: z.enum(SKILL_NAMES).describe('Skill to install'),
      }),
    },
    async ({ skill }) => ({ content: [{ type: 'text' as const, text: skillInstallGuide(skill) }] }),
  )
}
