The body of the AI rules lives in AGENTS.md. Write only Claude Code-specific content here.

@AGENTS.md

@CONTRIBUTING.md

# Claude Code-specific procedures

- For checking screen display / behavior, follow the `screen-check` skill (`.claude/skills/screen-check/SKILL.md`). Drive the browser via Playwright MCP (`playwright` in `.mcp.json`)
- Do the self-review before creating a PR with the `code-review` skill
- Use the `release` skill for latest (tagging, release notes) and stable
