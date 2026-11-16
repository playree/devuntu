/**
 * AI ツールのスキル(Agent Skills)の配布(サーバー専用)
 *
 * スキルの本体は依存パッケージに同梱されたもの(markdown-design-doc は embed の `agentSkill`)を使い、
 * Devuntu の `/api/skills/<name>/<path>` から配る。AI ツールはそこから取得するので、Devuntu もクライアントも
 * インターネットに出なくてよい。ファイルを書けないクライアント(claude.ai など)向けにだけ、配布元の zip を案内する。
 */

import designDocViewerPkg from 'markdown-design-doc-viewer-embed/package.json'
import { agentSkill as designDocSkill } from 'markdown-design-doc-viewer-embed/skill'
import { makeUrl } from './server-utils'

export const SKILL_NAMES = ['markdown-design-doc'] as const
export type SkillName = (typeof SKILL_NAMES)[number]

type AiSkillSource = {
  /** スキルの名前・revision・ファイル(スキルのフォルダからのパス → 本文) */
  skill: { name: string; revision: number; files: Readonly<Record<string, string>> }
  /** スキルが何をするかの一文(AI が利用者へ説明するのに使う) */
  purpose: string
  /** ファイルを書けないクライアント向けの zip。表示に使っている embed と同じ版のタグに固定する */
  zipUrl: string
}

const AI_SKILLS: Record<SkillName, AiSkillSource> = {
  'markdown-design-doc': {
    skill: designDocSkill,
    purpose:
      'write design documents in the Markdown Design Doc Viewer format (diagrams linked to the step headings after them), ' +
      'the format of design doc pages in the Devuntu Wiki',
    zipUrl:
      'https://github.com/playree/markdown-design-doc-viewer/releases/download/' +
      `v${designDocViewerPkg.version}/markdown-design-doc-skill.zip`,
  },
}

const isSkillName = (name: string): name is SkillName => (SKILL_NAMES as readonly string[]).includes(name)

/** スキルのファイルの本文。名前もパスも、同梱のものと完全に一致したときだけ返す(パスの細工は効かない) */
export const findAiSkillFile = (name: string, path: string): string | undefined => {
  if (!isSkillName(name)) {
    return undefined
  }
  const { files } = AI_SKILLS[name].skill
  return Object.hasOwn(files, path) ? files[path] : undefined
}

/** スキルの revision。配信で、手順を取得したときと同じ版かを確かめるのに使う */
export const aiSkillRevision = (name: string): number | undefined =>
  isSkillName(name) ? AI_SKILLS[name].skill.revision : undefined

/**
 * スキルのファイルの URL。手順を取得したときの revision を付け、取得の途中でサーバーが更新されても
 * 違う版のファイルが混ざらないようにする(配信側で不一致を 409 にする)
 */
export const skillFileUrl = (name: SkillName, path: string) =>
  makeUrl(`/api/skills/${name}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    revision: String(AI_SKILLS[name].skill.revision),
  })

/**
 * 手順に埋め込むパスの文字。依存パッケージのファイル名をシェルの二重引用符に埋めるので、展開されうる文字(`$` など)を含む版を
 * 取り込んだら、黙って壊れた手順を返さずに止める
 */
const SAFE_SKILL_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

/** 入れ替えも戻すのも失敗したときに出す文。退避した既存のフォルダは消さずに残し、その場所を利用者へ伝えさせる */
const KEPT_MESSAGE = 'Could not put back the previous skill. It is kept in'

/**
 * sh の手順。スキルのフォルダの中の一時フォルダ(同じファイルシステムなので mv は名前の付け替えになる)へ全ファイルを取得し、
 * SKILL.md を確かめてから既存のフォルダと入れ替える。入れ替えに失敗したら既存のフォルダを戻し、戻せなければ退避先を残す
 */
const shSteps = (name: SkillName, paths: string[]) =>
  [
    '(',
    '  set -e',
    '  dest="<skills folder>"',
    '  mkdir -p "$dest"',
    `  stage="$(mktemp -d "$dest/.${name}-XXXXXX")"`,
    `  trap 'rm -rf "$stage/new"; if [ ! -e "$stage/old" ]; then rm -rf "$stage"; fi' EXIT`,
    ...paths.flatMap((path) => [
      `  mkdir -p "$(dirname "$stage/new/${path}")"`,
      `  curl -fsSL -o "$stage/new/${path}" "${skillFileUrl(name, path)}"`,
    ]),
    '  test -f "$stage/new/SKILL.md"',
    `  if [ -e "$dest/${name}" ]; then mv "$dest/${name}" "$stage/old"; fi`,
    `  if mv "$stage/new" "$dest/${name}"; then`,
    '    rm -rf "$stage/old"',
    `  elif [ ! -e "$stage/old" ] || mv "$stage/old" "$dest/${name}"; then`,
    '    exit 1',
    '  else',
    `    echo "${KEPT_MESSAGE} $stage/old" >&2`,
    '    exit 1',
    '  fi',
    ')',
  ].join('\n')

/**
 * PowerShell の手順。sh と同じ順で、失敗したら止める。
 * フォルダ名の `[` `]` をワイルドカードとして解釈させないよう、パスは -LiteralPath と .NET の API で扱う
 * (Windows PowerShell 5.1 の Invoke-WebRequest -OutFile にはリテラルの指定が無いので、取得した内容を自分で書く)
 */
const powershellSteps = (name: SkillName, paths: string[]) => {
  const win = (path: string) => path.replaceAll('/', '\\')
  const dirs = [...new Set(paths.map((path) => path.split('/').slice(0, -1).join('/')).filter((dir) => dir !== ''))]
  return [
    '& {',
    "  $ErrorActionPreference = 'Stop'",
    '  $dest = "<skills folder>"',
    '  [void][IO.Directory]::CreateDirectory($dest)',
    `  $stage = Join-Path $dest (".${name}-" + [IO.Path]::GetRandomFileName())`,
    '  $keep = $false',
    '  try {',
    '    [void][IO.Directory]::CreateDirectory("$stage\\new")',
    ...dirs.map((dir) => `    [void][IO.Directory]::CreateDirectory("$stage\\new\\${win(dir)}")`),
    ...paths.flatMap((path) => [
      `    $res = Invoke-WebRequest -UseBasicParsing -Uri "${skillFileUrl(name, path)}"`,
      `    [IO.File]::WriteAllBytes("$stage\\new\\${win(path)}", $res.RawContentStream.ToArray())`,
    ]),
    `    if (-not (Test-Path -LiteralPath "$stage\\new\\SKILL.md")) { throw 'SKILL.md was not downloaded' }`,
    `    if (Test-Path -LiteralPath "$dest\\${name}") { Move-Item -LiteralPath "$dest\\${name}" -Destination "$stage\\old" }`,
    '    try {',
    `      Move-Item -LiteralPath "$stage\\new" -Destination "$dest\\${name}"`,
    '    } catch {',
    `      if (Test-Path -LiteralPath "$stage\\old") {`,
    `        try { Move-Item -LiteralPath "$stage\\old" -Destination "$dest\\${name}" }`,
    `        catch { $keep = $true; throw "${KEPT_MESSAGE} $stage\\old" }`,
    '      }',
    '      throw',
    '    }',
    '  } finally {',
    '    if ($keep) {',
    '      Remove-Item -LiteralPath "$stage\\new" -Recurse -Force -ErrorAction SilentlyContinue',
    '    } else {',
    '      Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue',
    '    }',
    '  }',
    '}',
  ].join('\n')
}

/** スキルのインストール手順(Markdown、英語) */
export const skillInstallGuide = (name: SkillName) => {
  const { skill, purpose, zipUrl } = AI_SKILLS[name]
  const paths = Object.keys(skill.files)
  const unsafe = paths.find((path) => !SAFE_SKILL_PATH.test(path))
  if (unsafe !== undefined) {
    throw new Error(`unsafe path in the skill ${name}: ${unsafe}`)
  }
  const { revision } = skill
  return `# Install the ${name} skill (revision ${revision})

The Agent Skill \`${name}\` lets you ${purpose}.
This Devuntu server serves its files, so neither you nor the server needs access to the internet:

${paths.map((path) => `- \`${path}\`: ${skillFileUrl(name, path)}`).join('\n')}

## 1. Ask the user where to install it

Ask the user before writing anything. Offer the skills folders of the tool you are running in:

| Tool | For all projects | For this project (commit it to share it with the team) |
|---|---|---|
| Claude Code | \`$HOME/.claude/skills\` | \`<project root>/.claude/skills\` |
| Codex | \`$HOME/.agents/skills\` | \`<project root>/.agents/skills\` |
| OpenCode | \`$HOME/.config/opencode/skills\` | \`<project root>/.opencode/skills\` |
| Other tools | the skills folder of the tool | |

If you cannot write files on the user's machine (claude.ai, Claude Desktop and the like), do not install it yourself:
give the user ${zipUrl} (the same skill, from GitHub) and ask them to upload the zip in the skills settings of the tool.

## 2. Check the copy already there

If \`<skills folder>/${name}/SKILL.md\` exists, read \`revision\` under \`metadata\` in its front matter, and compare it as an integer (it is written quoted, as \`"${revision}"\`):

- ${revision}: it is up to date if all the files above are there. Tell the user and stop (if some are missing, go on as for an older one)
- greater than ${revision}: it is newer than this one. Do not replace it
- less than ${revision}, or none: it is older. Tell the user that it will be replaced (changes made to its files are lost), and go on only if they agree

## 3. Download the files

Run the block for the user's OS as one command, with \`<skills folder>\` replaced by the chosen folder
(an absolute path or one starting with \`$HOME\`, not \`~\`, which is not expanded inside quotes).
It stops at the first error, downloads into a temporary folder in the skills folder, and replaces the existing folder only after all the files are downloaded
(if the replacement itself fails, the existing folder is put back).

macOS / Linux:

\`\`\`sh
${shSteps(name, paths)}
\`\`\`

Windows (PowerShell):

\`\`\`powershell
${powershellSteps(name, paths)}
\`\`\`

If it fails, tell the user the error:

- HTTP 409: this server was updated after you got these steps. Get them again with get_skill_install_guide and start over
- \`${KEPT_MESSAGE} <path>\`: the previous skill could not be put back. Tell the user that path, so that they can move it back to \`<skills folder>/${name}\`

## 4. Check it

- \`<skills folder>/${name}/SKILL.md\` exists, with revision ${revision}
- Tell the user where it was installed. Some tools load skills only when a session starts, so it may take effect from the next session
`
}
