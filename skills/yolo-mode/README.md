# yolo-mode

Lets a coding agent keep working after you walk away. Typically you start it before bed and read the report in the
morning. It works with any agent that can run shell commands and read files: Claude Code, Cursor, opencode, Codex,
Gemini CLI, Copilot, aider and others.

Unattended runs usually go wrong in one of two ways:

- **They stall.** The agent asks a question at 2 a.m., an approval prompt waits for a click, or the laptop goes to
  sleep. You come back to an hour of work and seven hours of waiting.
- **They overreach.** With nobody to ask, the agent merges the PR that deploys production, cleans up data it didn't
  create, or posts in a team channel.

This skill handles both. All the talking happens **before** you leave. The computer stays awake until the session
ends. The agent works inside rules you wrote down once, logs every call it makes on its own, and sends you a report.

> Several agents have a flag that approves everything (Claude Code's `--dangerously-skip-permissions`, Gemini CLI's
> `--yolo`). This skill isn't that flag. It works with whatever approval settings you choose, and adds a written
> agreement on what the agent may do without you.

## When to use it

- **Overnight or over a weekend** (the main use): a backlog of fixes, a migration, a test suite to make green,
  docs to bring up to date.
- **Away for an hour or two**, such as a meeting, lunch or a commute: same flow, with an earlier deadline.
- **Repetitive batches:** the same task across many items (re-record 20 demo videos, update 40 files, regenerate the
  docs). They're tedious to supervise, and the task rule covers every item once you've agreed it.
- **Work that is mostly waiting:** deploys, slow CI, long test runs, data loads. The agent waits, reads the
  failures, fixes them and tries again.
- **Do not disturb while you're at your desk:** you're in focus time and only want the result.
- **A written agreement even without a run:** the project file records what any agent may do in this repo (which
  environments, which git actions, what "done" means). It's useful for reviews, for onboarding, or for handing the
  project to a colleague. Because the file isn't tied to one agent, switching agents keeps the same limits.

## How a run goes

1. **Brief** (you're there). The agent loads the rules and splits the request into tasks. For each task the rules
   don't cover yet, it interviews you (with the `grill-me` skill if you have it) and adds the answer to the rules. It
   then asks every remaining question in one batch, including when you'll be back, and runs pre-flight checks:
   expired logins, approval prompts that would block, battery, disk space, and whether the notification channel
   works.
2. **Activation.** It creates a run branch and a run log, starts keep-awake, and tells you what it will and won't do.
   From here on it asks nothing.
3. **Run.** It works through the tasks and checks every action against the rules. Anything the rules don't allow is
   skipped and reported, never done "just this once". When something is unclear it follows your `on_blocked`
   setting: decide and log, skip, or stop. A task counts as done only when the project's definition of done holds.
4. **Report.** The log lists what's done, the calls it made alone (with the alternatives), what it skipped and why,
   the test results, the links, and what to look at first. It reaches you through your notification channel, and
   keep-awake stops.

## Configuration

The skill configures itself on first use: it detects what it can, asks you the rest, and saves two plain YAML files.
They sit outside any agent's own folders, so every agent reads the same rules.

| File | What it holds | Why separate |
| --- | --- | --- |
| `~/.config/yolo-mode/profile.yaml` (`$XDG_CONFIG_HOME` if set) | You and your machine: keep-awake, how to reach you, rules for every project | Set up once per machine, not once per repo |
| `<project>/.yolo-mode.yaml` | The project: git limits, environments and their access level, outward actions, known tasks, definition of done, pre-flight checks | Each repo has its own risks. You can share the file with your team without sharing your own notification settings |

The rules are deny-by-default. An environment that isn't listed is off-limits, and a kind of work not in `tasks:` gets
discussed during the next brief before it can run. When the two files disagree, the stricter one wins. The rule set
grows as you use it: the first run of a new kind of work takes a few questions, and later runs take none.

A project file looks like this (the full commented template is [templates/project.yaml](templates/project.yaml)):

```yaml
git:
  allowed: [commit, push_branch, open_pr]
  never: [force_push, push_base, merge_pr]
  notes: Merging into main deploys production.
environments:
  - { name: staging, kind: kubernetes-context, access: write }
  - { name: production, kind: kubernetes-context, access: read }
tasks:
  - id: fix-failing-tests
    allowed: true
    limits: [Never weaken, skip or delete a test to make it pass.]
    verify: [npm test]
```

By default the project file stays local (`.git/info/exclude`), because it grants *your* permissions. Commit it if
the team should share one set of limits.

Edit either file by hand at any time, or ask the agent to "update the YOLO rules". The agent never changes them
during a run. Run logs go to `~/.local/state/yolo-mode/runs/` (`$XDG_STATE_HOME` if set).

## Keeping the computer awake

`scripts/keep-awake.sh` finds your agent's process and keeps the machine awake until that process ends, you run
`stop`, or a time cap passes (`--hours`, default 14), whichever comes first. Nothing keeps running after the
session. It recognises `claude`, `codex`, `gemini`, `opencode`, `cursor-agent`, `copilot`, `aider` and `goose`, as a
binary or as a node, bun, deno or python script. Use `--name` or `YOLO_AGENT_NAMES` for others.

```bash
bash scripts/keep-awake.sh check    # platform, sleep blocker, power source, agent process
bash scripts/keep-awake.sh start    # options: --hours 30, --pid 1234, --name "myagent"
bash scripts/keep-awake.sh status
bash scripts/keep-awake.sh stop
```

| Platform | How | Tested |
| --- | --- | --- |
| macOS | `caffeinate -dims -w <agent pid> -t <cap>` | Yes: holds all four assertions, ends with the process and at the cap, finds native and node-based agents |
| Linux with systemd | `systemd-inhibit --what=idle:sleep` | Syntax check only |
| Windows (Git Bash, MSYS2, Cygwin) | `keep-awake.ps1`: `SetThreadExecutionState`, watches the agent process | No |
| WSL | `keep-awake.ps1` through `powershell.exe`, with a Linux-side watcher | No |
| Windows without bash | `powershell -File scripts/keep-awake.ps1 -Hours 14 -WatchPid <pid>` | No |
| Anything else | None: set the power settings to never sleep for the night | |

It uses only what ships with the OS, so there's nothing to install (some company policies flag keep-awake apps).
IDE agents have no process of their own, so for them only the time cap applies. Name the editor with `--name` to
end with it instead.

## Install

Put the folder where your agent loads skills. To serve several agents, keep one copy and symlink it into each:

```sh
git clone <repo-url> ~/Repo/personal-skills
ln -s ~/Repo/personal-skills/skills/yolo-mode ~/.claude/skills/yolo-mode   # Claude Code
ln -s ~/Repo/personal-skills/skills/yolo-mode ~/.cursor/skills/yolo-mode   # Cursor
ln -s ~/Repo/personal-skills/skills/yolo-mode ~/.agents/skills/yolo-mode   # opencode and other agents reading ~/.agents
```

Agents without skill support: add one line to the instruction file they read (`AGENTS.md`, `GEMINI.md`,
`CONVENTIONS.md`): *When I say "YOLO mode", read and follow `~/Repo/personal-skills/skills/yolo-mode/SKILL.md`.*

[AGENT-NOTES.md](AGENT-NOTES.md) lists, for each agent, the skill folders and the approval settings that keep a run
from stalling, and marks which entries were checked on a real install.

It needs bash (Git Bash or WSL on Windows) for keep-awake. The `grill-me` skill (from
[mattpocock/skills](https://github.com/mattpocock/skills)) is optional: without it, the agent runs the same
one-question-at-a-time interview itself. Then say "YOLO mode" in a session.

## Limits

- **The rules are instructions, not a sandbox.** The agent follows them, but they don't technically block anything.
  For hard limits, also add deny rules to your agent's approval settings (for example, deny `git push` to main).
  AGENT-NOTES.md shows where.
- **Hardware still wins.** On battery or with the lid closed, a laptop can still sleep: stay plugged in and leave it
  open. A screen lock set by company policy still happens, and it doesn't pause the work.
- **Logins expire.** Pre-flight checks the ones it knows about. Add the rest to `preflight:` in the project file.
- **Costs keep running.** A long run spends tokens, and sometimes paid platform actions (API calls, agent credits,
  CI minutes). Put caps in the task limits.
- **Agents differ.** Some can't run background jobs or ask multiple-choice questions. The skill falls back to
  polling and numbered lists, but a turn that ends early still ends the run.

## Files

```
yolo-mode/
├── SKILL.md              # the brief → run → report procedure the agent follows
├── SETUP.md              # first-run interview that builds the two rule files
├── AGENT-NOTES.md        # per agent: skill folders, approval settings, process names, questions, background jobs
├── templates/
│   ├── profile.yaml      # starting point for ~/.config/yolo-mode/profile.yaml
│   ├── project.yaml      # starting point for <project>/.yolo-mode.yaml
│   └── run-log.md        # the run log, which becomes the report
└── scripts/
    ├── keep-awake.sh     # check | start | status | stop, on macOS, Linux, Windows and WSL
    └── keep-awake.ps1    # the Windows side, also usable on its own
```
