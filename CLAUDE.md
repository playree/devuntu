AI 向けのルールの本文は AGENTS.md に置き、ここには Claude Code に固有の内容だけを書く。

@AGENTS.md

@CONTRIBUTING.md

# Claude Code に固有の手順

- 画面の表示・動作確認はスキル `screen-check`(`.claude/skills/screen-check/SKILL.md`)の手順に従う。ブラウザ操作は Playwright MCP(`.mcp.json` の `playwright`)経由
- PR 作成前のセルフレビューはスキル `code-review` で行う
- latest(タグ打ち・リリースノート)と stable はスキル `release` で行う
