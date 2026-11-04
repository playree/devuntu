# Project overview

A self-hosted project management tool centered on kanban boards / tickets, with calendar integration,
notifications (email / Slack / web push), an MCP server, and AI agent integration.

- Node.js v24
- Next.js v16
- TypeScript v7 (coexisting with TypeScript v6)
- pnpm v12
- Prisma v7
- Better Auth v1.7
- Tailwind CSS v4
- HeroUI v3
- Zod v4
- next-safe-action v8

## Documentation

When investigating or changing a feature or spec, read and update the corresponding docs. The docs are written in Japanese.

docs are split by audience: `guide/` (users), `admin/` (operators), `dev/` (developers). Entry point: [docs/README.md](docs/README.md).

| File                                                                       | Contents                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [README.md](README.md)                                                     | Top-level entry point. Index of all docs                              |
| [README.en.md](README.en.md)                                               | English README (overview, quick start)                                |
| [docs/README.md](docs/README.md)                                           | Docs entry point (by audience)                                        |
| [docs/guide/README.md](docs/guide/README.md)                               | List of user docs                                                     |
| [docs/guide/getting-started.md](docs/guide/getting-started.md)             | Getting started (first 30 minutes, terms, roles and permissions, FAQ) |
| [docs/guide/user-guide.md](docs/guide/user-guide.md)                       | How to use each screen                                                |
| [docs/guide/ai.md](docs/guide/ai.md)                                       | Connecting MCP, delegating to agents, approvals                       |
| [docs/admin/README.md](docs/admin/README.md)                               | Post-install tasks, admin screens                                     |
| [docs/admin/installation.md](docs/admin/installation.md)                   | Self-hosted installation, HTTPS                                       |
| [docs/admin/operations.md](docs/admin/operations.md)                       | Backup / restore, maintenance                                         |
| [docs/admin/environment-variables.md](docs/admin/environment-variables.md) | Environment variables (quick reference and full list)                 |
| [docs/admin/notifications.md](docs/admin/notifications.md)                 | Notification settings, Slack App                                      |
| [docs/admin/git-integration.md](docs/admin/git-integration.md)             | GitHub / GitLab integration webhook setup                             |
| [docs/admin/mcp-server.md](docs/admin/mcp-server.md)                       | MCP server exposure settings, token operation                         |
| [docs/admin/agent-runner.md](docs/admin/agent-runner.md)                   | Installing / configuring automated AI agent operation                 |
| [docs/admin/command-exec.md](docs/admin/command-exec.md)                   | Remote execution definitions, SSH, permissions                        |
| [docs/dev/README.md](docs/dev/README.md)                                   | List of developer docs                                                |
| [docs/dev/development.md](docs/dev/development.md)                         | Dev environment, build, package management                            |
| [docs/dev/screens.md](docs/dev/screens.md)                                 | Screens / APIs and access control                                     |
| [docs/dev/mcp-tools.md](docs/dev/mcp-tools.md)                             | MCP tools, permissions, image attachment API                          |
| [docs/dev/operations-internals.md](docs/dev/operations-internals.md)       | How backup and maintenance work                                       |
| [docs/dev/notifications-internals.md](docs/dev/notifications-internals.md) | How notifications work (queue, triggers, channels)                    |
| [docs/dev/mcp-server-internals.md](docs/dev/mcp-server-internals.md)       | MCP server authentication and input spec implementation               |
| [docs/dev/agent-runner-internals.md](docs/dev/agent-runner-internals.md)   | How automated AI agent operation works                                |
| [docs/dev/command-exec-internals.md](docs/dev/command-exec-internals.md)   | Implementation decisions for remote execution                         |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                         | Development conventions (branches, commits, PRs, coding rules)        |
| [site/index.html](site/index.html)                                         | Product site (ja/en). Conventions are in development.md               |
| [SECURITY.md](SECURITY.md)                                                 | How to report vulnerabilities                                         |

# Development conventions

Branch, commit, PR, and coding rules are in [CONTRIBUTING.md](CONTRIBUTING.md). Read and follow it before starting work.

# Checking screens

- Keep screen checks to the minimum needed. Not required for minor fixes.
- Run the browser headless (no DISPLAY)
- The dev server must be `http://localhost:3000`. `BETTER_AUTH_URL` is fixed to localhost:3000, so on any other port auth POSTs fail the origin check with 403
- If `pnpm dev` is already running, reuse it and do not restart it. If you started it yourself, stop it when done
- Login is via email OTP. Get the OTP from the `verification` table (`sign-in-otp-<lowercased email>`)
- Dev server log goes to `.work/dev-server.log`, screenshots to `.work/playwright`

# Locale files

- src/locale/index.ts
- src/locale/lang-ja.ts
- src/locale/lang-en.ts

# Files excluded from code review

Keep in sync with `path_filters` in `.coderabbit.yaml`.

- `src/generated/**`
- `prisma/migrations/**`
- `**/*.lock`

# Versioning and releases

- The released version is defined by the remote tags (`v<version>` / `stable`). Check with `pnpm release:version`
- After creating a feature branch, run `pnpm release:version --bump`. If the version was bumped, make that alone the first commit (e.g. `v1.0.2 start (DEVUNTU-1)`)
  - Look up the release ticket (see the board's AI context) by the bumped version
  - With an already-released version, PR CI and the edge build fail
- The edge build is done by a human

# Self-review before creating a PR

- Before creating a PR, self-review the diff against main
- Fix each finding, or decide why not to, before opening the PR. List unfixed findings and the reasons in the PR description
- If you fixed anything during self-review, re-run `pnpm lint` / `pnpm typecheck` / `pnpm test` before opening the PR
- Skip the files excluded from code review (above)

# Replying to PR reviews

- Reply to review comments **only after committing the fix and pushing it to the remote**
  - Review tools (CodeRabbit, etc.) look at the remote, so replying "fixed" after only changing the working tree contradicts what they see
  - "Committed but not pushed" is equally not OK
- Do not rebut unaddressed comments or answer questions while uncommitted changes remain in the working tree either (commit and push first, or stash the changes)

# Next.js

`next dev` manages the block below. Do not edit inside it.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
