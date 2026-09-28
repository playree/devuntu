# Devuntu Agent Setup

Set things up so that an AI agent CLI starts automatically when tickets are assigned to the agent.
Run these steps on **the machine that runs the agent** (nothing is done on the devuntu server).

There is no resident process. cron starts a one-shot script every {{intervalMinutes}} minutes,
and the script asks devuntu whether there are tickets to process. If there are, it starts the CLI.

## Prerequisites

- **CLI**: these steps assume the agent runs on **{{cliLabel}}** (`{{cliKind}}`).
  What to do with each ticket is read from devuntu (MCP), so the behavior is the same with either CLI
- **Agent token**: issued by a devuntu administrator at `{{baseUrl}}/admin/agents`
  (a string starting with `devuntu_agent_`, shown only once when issued)
- **Working directory**: the base directory where the agent clones repositories to work on.
  The runner, its configuration, and its logs also live under it, so one agent is fully contained in this directory

The token is written in only one place, the configuration file (`.devuntu-agent/config.json`). The MCP
configuration only references the environment variable `DEVUNTU_AGENT_TOKEN`, which the runner passes when it starts the CLI.

## 1. Check the required commands

```sh
python3 --version   # 3.9 or later
git --version
```

<!-- cli:claude -->

```sh
claude --version
command -v claude   # Actual location. Use it when cron cannot find the command
```

<!-- /cli -->
<!-- cli:codex -->

```sh
codex --version
command -v codex    # Actual location. Use it when cron cannot find the command
```

<!-- /cli -->

Install anything that is missing first.

cron does not read shell configuration files (such as `.bashrc`), so the PATH you see here is not
inherited by cron. Step 5 (`save-path`) closes this gap.

`gh` (GitHub CLI) is not required. Install it separately only if you want post-work instructions to create
PRs automatically with `gh pr create`.

## 2. Prepare the working directory

The agent may work on more than one repository, so `~/devuntu-agent-work` is not a clone of a specific
repository but a **base directory** under which the needed repositories are cloned.
The agent decides which repository to work on from the ticket content and the pre-work instructions (step 7).

Do not share it with a directory a person works in. The agent could pick up uncommitted changes
or fight over branches.

The runner, configuration file, logs, and lock file are kept together in `.devuntu-agent` directly under it.
To run multiple agents on the same machine, give each working directory its own set
(see "Running multiple agents on the same machine").

```sh
mkdir -p ~/devuntu-agent-work/.devuntu-agent
cd ~/devuntu-agent-work
grep -qxF '.devuntu-agent' .gitignore 2>/dev/null || echo '.devuntu-agent' >> .gitignore
```

`.devuntu-agent` contains a configuration file holding the token in plain text. Add it to `.gitignore` so it
is not committed if the working directory itself is managed with git (the file is created if missing).

## 3. Register the MCP server

Register the devuntu MCP server with the agent token. This path does not involve browser login or consent.
Put the configuration **directly under the working directory**. cron always starts the CLI from this directory,
so the configuration is loaded no matter which repository is being processed.

Do not write the token itself; reference the environment variable `DEVUNTU_AGENT_TOKEN` passed by the runner.
The token then lives only in `config.json` from step 5, so there is only one place to update when it is reissued.

**Append to the configuration file instead of overwriting it.** It may contain settings for other MCP servers.

<!-- cli:claude -->

Save it to `.mcp.json` (`--scope project`). The literal string `${DEVUNTU_AGENT_TOKEN}` must be saved,
so wrap it in single quotes to keep the shell from expanding it.

```sh
cd ~/devuntu-agent-work
claude mcp add --transport http devuntu-agent {{mcpUrl}} \
  --scope project \
  --header 'Authorization: Bearer ${DEVUNTU_AGENT_TOKEN}'
```

Claude Code expands this notation to the environment variable when loading, so no secret remains in `.mcp.json`.
Check with `cat .mcp.json` that `${DEVUNTU_AGENT_TOKEN}` is stored unexpanded
(if the expanded value was stored, replace it with `${DEVUNTU_AGENT_TOKEN}`).

Run `claude mcp list` inside the working directory and confirm that `devuntu-agent` appears
(project-scoped settings are tied to the current directory, so they do not appear when run elsewhere).
At this point the shell has no `DEVUNTU_AGENT_TOKEN`, so the connection fails. That is expected (it is verified in step 6).
<!-- /cli -->
<!-- cli:codex -->

Add the following block to `.codex/config.toml` (the file is created if missing).

```sh
cd ~/devuntu-agent-work
mkdir -p .codex
grep -qF '[mcp_servers.devuntu-agent]' .codex/config.toml 2>/dev/null || cat >> .codex/config.toml <<'TOML'

[mcp_servers.devuntu-agent]
url = "{{mcpUrl}}"
bearer_token_env_var = "DEVUNTU_AGENT_TOKEN"
TOML
```

TOML does not allow defining the same table twice, and a duplicate makes codex unable to read the configuration file.
That is why the command does not append when the block already exists. To change the URL or the token
environment variable name, edit the existing block directly instead of using this command.

Codex **reads project configuration only in trusted directories**, so also add a line to the user configuration
(`~/.codex/config.toml`) that trusts the working directory.

```sh
mkdir -p ~/.codex
grep -qF "[projects.\"$HOME/devuntu-agent-work\"]" ~/.codex/config.toml 2>/dev/null || cat >> ~/.codex/config.toml <<TOML

[projects."$HOME/devuntu-agent-work"]
trust_level = "trusted"
TOML
```

Run `codex mcp list` inside the working directory and confirm that `devuntu-agent` appears.

If no person uses Codex on that machine (a dedicated agent machine), you may instead register it in the user
configuration with the single command
`codex mcp add --url {{mcpUrl}} --bearer-token-env-var DEVUNTU_AGENT_TOKEN devuntu-agent`.
No trust setting is needed in that case, but `devuntu-agent` will also show up in Codex sessions a person uses.
<!-- /cli -->

## 4. Fetch the runner

```sh
cd ~/devuntu-agent-work
curl -fsSL {{scriptUrl}} -o .devuntu-agent/devuntu_agent.py
chmod +x .devuntu-agent/devuntu_agent.py
python3 .devuntu-agent/devuntu_agent.py --version
```

Each time the runner starts, it fetches the latest version from this URL and rewrites itself if there is a difference.
On a run where it rewrites itself, it exits without processing so that the old version does not process tickets.
Since it is not a resident process, no restart or cron re-registration is needed; the next cron run uses the new version.
To disable this, set `"self_update": false` in `config.json`.

## 5. Create the configuration file

It holds the token in plain text, so always set the permissions to 600.

Put the configuration file in `.devuntu-agent`, next to the runner. The runner reads the `config.json`
next to itself, so there is no need to add a path to the cron line.

```sh
cat > ~/devuntu-agent-work/.devuntu-agent/config.json <<'JSON'
{
  "base_url": "{{baseUrl}}",
  "token": "<issued token>",
  "cli": {
    "kind": "{{cliKind}}",
    "path": [],
    "env": {}
  },
  "timeout_sec": 3600
}
JSON
chmod 600 ~/devuntu-agent-work/.devuntu-agent/config.json
```

`bin` / `args` / `model` have per-CLI defaults, so write them only when you want to change them.

- `workdir`: working directory. When omitted, the parent of `.devuntu-agent` (the directory created in step 2)
  is used, so normally leave it out. Specify an absolute path only to start from a different location
- `cli.kind`: kind of CLI to start. In these steps, `{{cliKind}}` ({{cliLabel}})
- `cli.bin`: command to run. When omitted, the same value as `cli.kind` (`{{cliKind}}`) is used
- `cli.args`: no one can answer permission prompts under cron, so the default auto-approves.

<!-- cli:claude -->

- The default is `--permission-mode auto` (auto-approves all tool use including Bash, not just file edits)

<!-- /cli -->
<!-- cli:codex -->

- The default is `--sandbox danger-full-access --skip-git-repo-check`. The working directory is the base for
  clones and not a git repository, so codex refuses to start without `--skip-git-repo-check`

<!-- /cli -->

- **Caution**: these defaults **assume the agent runs on a dedicated host**. The ticket content and comments
  the agent reads can act directly as instructions to the agent, so with the defaults, malicious (or mistaken)
  ticket content can make it perform file operations outside the working directory and external communication
  without restriction. Do not run it on a machine people use daily, or on a host with keys or credentials
  the agent should not touch. Judge the risk operationally, for example by limiting who can create or comment on
  tickets assigned to the agent to trusted people. To restrict it further,

<!-- cli:claude -->

    switch to `--permission-mode acceptEdits` (auto-approve edits only) or `--disallowedTools`

<!-- /cli -->
<!-- cli:codex -->

    switch to `--sandbox workspace-write -c sandbox_workspace_write.network_access=true`
    (keep `--skip-git-repo-check`). `workspace-write` blocks the network by default, so without
    `network_access=true`, `git clone` and dependency installation fail.
    Writes outside the workspace such as `~/.npm` or `~/.cache` are also rejected, so if the agent builds
    the project, check that it does not get stuck there before using it

- Add `-c <key>=<value>` here to override codex settings (repeatable). A common one is
  reasoning effort, `-c model_reasoning_effort="high"` (`minimal` / `low` / `medium` / `high` / `xhigh`).
  To switch model and reasoning settings together, use `--profile <name>`
  (`~/.codex/<name>.config.toml` is layered over the base settings)

<!-- /cli -->
<!-- cli:claude -->

- `cli.model`: model to use. Defaults to `opus`. Any alias accepted by `--model`, such as `sonnet` / `fable`,
  can be specified

<!-- /cli -->
<!-- cli:codex -->

- `cli.model`: model to use. No default. To specify one, write the model name as is, like `"model": "gpt-5.5"`
  (passed as `codex exec --model <value>`). When omitted, `model` in `~/.codex/config.toml` is used,
  or the codex default model if that is not set either

<!-- /cli -->

- `cli.path`: directories prepended to PATH when starting the CLI. Leave it empty and fill it with
  `save-path` below (write it by hand only for unusual setups). This PATH is also passed to the CLI itself,
  so it also resolves `git` / `node` / `pnpm` / `gh` that the agent runs
- `cli.env`: extra environment variables passed to the CLI (e.g. `{"GH_TOKEN": "..."}`). Under cron,
  variables exported in the shell are not inherited, so write the ones you need here.
  `DEVUNTU_AGENT_TOKEN`, referenced by the MCP configuration, is passed automatically by the runner from `token`, so you do not need to write it
- `timeout_sec`: a CLI running longer than this is stopped and the run is recorded as failed

After creating the configuration, import the PATH of your current shell into it as is.

```sh
python3 ~/devuntu-agent-work/.devuntu-agent/devuntu_agent.py save-path
```

cron does not read shell configuration files, so cron's PATH is only about `/usr/bin:/bin`.
This command saves **the PATH of the current shell**, where the CLI and `git` are found (existing directories only),
to `cli.path`. The runner prepends it to PATH before starting the CLI,
so commands resolve under cron the same way as in this shell.

The saved directories and the location where the CLI was found are shown.
If you see `... not found`, that CLI is not available in the shell.

Run it again whenever PATH changes, for example after upgrading node or reinstalling the CLI.
(Even without `save-path`, the runner looks in common install locations such as `~/.local/bin` and nvm's node
by itself. `save-path` makes it reliable.)

## 6. Check connectivity

```sh
python3 ~/devuntu-agent-work/.devuntu-agent/devuntu_agent.py poll --dry-run
```

How to read the output:

- `run conditions not met: reason=no_runner` → automation is not configured yet in the admin screen (see the next step)
- `run conditions not met: reason=disabled` → configured but disabled. Enable it in the admin screen
- `run conditions not met: reason=outside_hours` → outside the allowed hours. Working as configured
- `run conditions not met: reason=daily_limit` / `reason=monthly_budget` → the daily run limit / monthly budget has been reached. Working as configured
- `no tickets to process` → connectivity and run conditions are fine
- `dry-run: would process ... with /path/to/{{cliKind}}` → confirmed down to the location of the CLI to start
- `{{cliKind}} not found (PATH=...)` → the CLI cannot be found. Set `cli.path` or `cli.bin`
- `401` is returned → the token is wrong (or it was reissued and is outdated)

To check the MCP side (whether the token reaches the CLI and it can connect to devuntu), load the environment
variables and then run the CLI's list command.

```sh
cd ~/devuntu-agent-work
eval "$(python3 .devuntu-agent/devuntu_agent.py env)"
{{cliKind}} mcp list
```

The `env` subcommand prints the same environment variables the runner passes to the CLI (`DEVUNTU_AGENT_TOKEN` and PATH)
in `export` form. Run it first whenever you run the agent by hand to check things.

## 7. Configure automation in the admin screen

At `{{baseUrl}}/admin/agents`, open automation for the agent's row and set the following.

- **Enabled**: turn it on
- **Allowed hours**: e.g. run only at night. Unset means all day
- **Poll interval**: match the cron interval (available values: {{pollIntervalOptions}})
- **Default mode**: the mode used when the ticket does not specify one
- **Pre-work / post-work**: instructions the agent reads before and after processing a ticket. Examples:
  - Pre-work: `Determine the repository from the ticket content; clone it under ~/devuntu-agent-work if missing,
otherwise git pull, then create a branch named after the ticket display ID`
  - Post-work: `Make lint and the build pass, then create a PR with gh pr create`

## 8. Register with cron

The runner itself prevents concurrent runs with `.devuntu-agent/agent.lock`. If the previous CLI is still running,
that run does nothing and exits. The lock is per working directory, so it does not interfere with other agents on
the same machine. Keep the cron line to just running the runner and do not add a locking mechanism on the cron side
(it would double up with the runner's lock, the runner would fail to acquire it every time, and every run would be skipped).

```sh
( crontab -l 2>/dev/null; \
  echo "*/{{intervalMinutes}} * * * * python3 ~/devuntu-agent-work/.devuntu-agent/devuntu_agent.py poll" \
) | crontab -
crontab -l
```

There is no need to add PATH to the cron line. The runner passes the PATH saved by `save-path` in step 5
to the CLI. If you still get `not found`, write the absolute path found with `command -v {{cliKind}}`
to `cli.bin` in `config.json`.

The log is `~/devuntu-agent-work/.devuntu-agent/agent.log` (rotated at 1MB, up to 3 generations).

## 9. Try it

1. Create a ticket in devuntu and assign it to the agent
2. Choose the mode under the agent section of the ticket detail
   - **Plan first**: posts a plan, stops, and waits for a reply. Replying continues the processing
   - **Auto**: works on it without a plan and reports
3. Wait for the next cron run (to try it right away, run `python3 ~/devuntu-agent-work/.devuntu-agent/devuntu_agent.py poll` by hand)
4. Check the result in the ticket comments and the run history in the admin screen

## 10. Keep these steps as a skill

Write the content of this guide into the working directory so the same environment can be rebuilt.

<!-- cli:claude -->

Put it in `.claude/skills/devuntu-agent/SKILL.md` with the following frontmatter at the top.

```yaml
---
name: devuntu-agent
description: Set up devuntu automated operation (Devuntu Agent) on this machine and verify that it works.
---
```

<!-- /cli -->
<!-- cli:codex -->

Write it to `AGENTS.md` (no frontmatter needed).
<!-- /cli -->

Do not write the token (keep it only in the configuration file).

## Running multiple agents on the same machine

One agent is fully contained in its working directory, so just prepare a working directory per agent
and repeat steps 2 to 8.

```text
~/devuntu-agent-work-a/.devuntu-agent/{devuntu_agent.py,config.json,agent.log,agent.lock}
~/devuntu-agent-work-b/.devuntu-agent/{devuntu_agent.py,config.json,agent.log,agent.lock}
```

- Issue a token per agent and register MCP in each working directory (step 3).
  The MCP configuration only holds the environment variable reference; the actual token comes from each working directory's `config.json`

<!-- cli:codex -->

- The trust setting (`projects.<path>.trust_level`) is in the user configuration, so add one line per working directory

<!-- /cli -->

- Register a cron line per working directory as well
- Locks and logs are separate per working directory, so agents do not skip each other or mix logs

## Troubleshooting

| Symptom                                        | Where to look                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Automation stays "Offline" in the admin screen | Whether cron is running (`crontab -l`), `.devuntu-agent/agent.log`                                                                 |
| The run history is full of "Failed"            | The run's content contains the exit code and the tail of stderr                                                                    |
| A run stays "Running"                          | The agent could not call `finish_agent_task`. It automatically becomes failed after 60 minutes                                     |
| Tickets are not picked up                      | Whether the ticket is assigned to the agent, and whether the ticket's agent mode is still pending selection                        |
| Fails with `... not found`                     | Run `devuntu_agent.py save-path` again in a shell where that CLI works. If that does not help, write an absolute path to `cli.bin` |

<!-- cli:claude -->

| The agent cannot connect to MCP | Whether `${DEVUNTU_AGENT_TOKEN}` in `.mcp.json` has been replaced by the expanded value (step 3) |
<!-- /cli -->
<!-- cli:codex -->

| The agent cannot connect to MCP | `bearer_token_env_var` in `.codex/config.toml`, and the trust setting for the working directory (step 3) |
<!-- /cli -->
