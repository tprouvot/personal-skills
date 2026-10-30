# Agent notes

The procedure in [SKILL.md](SKILL.md) is the same for every agent. Three things differ: where the skill is
installed, how to stop approval prompts from blocking a run, and which process keep-awake waits for.

The "Checked" column says how each entry was confirmed. Flags change between releases, so confirm the others against
your version's `--help` or docs before relying on them for a night.

## Installing the skill

| Agent | Skill folders | Checked |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/`, `<project>/.claude/skills/` | yes, Claude Code |
| Cursor | `~/.cursor/skills/`, `<project>/.cursor/skills/` | yes, Cursor's own create-skill guide |
| opencode | `~/.agents/skills/`, `~/.claude/skills/`, `<project>/.opencode/skills/` | yes, `opencode debug skill` |
| Other agents that read `SKILL.md` | their skills folder. Several share `~/.agents/skills/` | no |
| Agents without skills (aider and others) | add one line to the instruction file the agent reads (`AGENTS.md`, `GEMINI.md`, `CONVENTIONS.md`): *When I say "YOLO mode", read and follow `<path>/yolo-mode/SKILL.md`.* | no |

To serve several agents from one copy, keep the folder in one place and symlink it into each agent's folder.

## Approval prompts

During the run, any approval prompt waits until morning. Before activation, allow what the run needs and keep deny
rules for what the rule files forbid: they're a second, technical limit behind the agent's own discipline.

| Agent | Let the run proceed | Keep a hard limit with | Checked |
| --- | --- | --- | --- |
| Claude Code | auto mode, or `permissions.allow` in `.claude/settings.json` | `permissions.deny` (e.g. pushing to main) | yes |
| Cursor CLI | `permissions.allow` in `~/.cursor/cli-config.json`, e.g. `"Shell(npm test)"` | `permissions.deny` | yes, the config file |
| opencode | `"permission": { "edit": "allow", "bash": { "*": "allow" } }` in `opencode.json` | `"deny"` patterns in the same map, e.g. `"git push*": "deny"` | yes, built-in docs |
| Codex CLI | `--ask-for-approval never` with `--sandbox workspace-write` | the sandbox. Network is off in it by default, so `git push` and deploys need network access turned on | no |
| Gemini CLI | `--approval-mode auto_edit`, or `--yolo` to approve everything | none with `--yolo`: the rule files are then the only limit | no |
| GitHub Copilot CLI | `--allow-tool` per tool, or `--allow-all-tools` | `--deny-tool` | no |
| aider | `--yes-always` | none | no |

IDE agents (an editor's built-in chat) usually have a setting that auto-runs terminal commands, plus an allow or deny
list. Turn it on for the run only.

## Keep-awake and the agent process

`scripts/keep-awake.sh` walks up from its own shell and stops at the first process named `claude`, `codex`, `gemini`,
`opencode`, `cursor-agent`, `copilot`, `aider` or `goose`. That can be the binary itself, or node, bun, deno or python
running a script of that name. Other agents: `--name "myagent"`, or set `YOLO_AGENT_NAMES` once in your shell profile.

- **IDE agents** have no process of their own, so the script finds none and only the `--hours` cap ends the
  keep-awake. To end it with the editor instead, name the editor's process: `--name Cursor` or `--name Code` on
  macOS, `--name code` on Linux.
- **Windows without bash:** run `powershell -File scripts/keep-awake.ps1 -Hours 14 -WatchPid <agent pid>` in the
  background, and end it with `Stop-Process` once the run is over.

## Asking the brief's questions

Use the agent's multiple-choice question tool if it has one (Claude Code: `AskUserQuestion`, up to four questions per
call). Otherwise post a numbered list with the recommended option marked, and ask for all the answers in one reply.

## Waiting on long jobs

Ending the turn ends the run in most agents. Use background jobs if the agent has them (Claude Code: background
Bash plus a monitor or wake-up). Otherwise run the command in the foreground with a timeout and check on it again.
