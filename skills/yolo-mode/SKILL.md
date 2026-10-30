---
name: yolo-mode
description: Runs work unattended while the user is away (overnight, a weekend, a long meeting). Asks every question before starting and none after, keeps the computer awake for the whole session, stays inside the limits of a per-project rules file it builds with the user on first use, logs each decision it takes alone and sends a report at the end. Works with any coding agent that runs shell commands. Use when the user says "YOLO mode", "/yolo-mode", "run this overnight", "while I'm away", "I'm leaving the computer", or asks for an unattended run, or wants to set up or change the YOLO rules.
---

# YOLO mode

A run has three phases: **brief** (the user is still here), **run** (nobody is), **report**. What the run may do comes
from two rule files. Anything they don't cover gets settled during the brief, never during the run.

| File | Holds | Created |
| --- | --- | --- |
| `${XDG_CONFIG_HOME:-~/.config}/yolo-mode/profile.yaml` | the person and the machine: keep-awake, how to reach them, rules for every project | first run on this machine |
| `<project root>/.yolo-mode.yaml` | the project: git, environments, outward actions, known tasks, definition of done, pre-flight | first run in this project |

When the files disagree, the stricter rule wins; a project file can't loosen the profile's `standing_rules`. Run logs
go to `${XDG_STATE_HOME:-~/.local/state}/yolo-mode/runs/`. `S` below is the `scripts/` folder next to this file. What
differs between agents (questions, approval settings, background jobs) is in [AGENT-NOTES.md](AGENT-NOTES.md).

## 1. Brief

1. **Load the rules.** If a file is missing, build it with the user first: [SETUP.md](SETUP.md). Re-read both files
   even if you saw them earlier in the conversation; the user may have edited them.
2. **Split the work into tasks** (the request, or the work already under way when the user switches to YOLO mode)
   and match each one to an entry in the project's `tasks:`. It matches when the entry covers the same kind of work on
   the same environments, within its limits.
3. **Unknown tasks:** settle each one with the `grill-me` skill, scoped to that task, if you have it. If not,
   interview the same way: one question at a time, each with your recommended answer, and read the code instead of
   asking when it holds the answer. Settle: allowed or not, environments, limits, how to verify it, how to undo it,
   this project or every project. Then add the entry (project `tasks:`, or `standing_rules` in the profile) and show
   the diff.
4. **Ask everything else now, in one batch** (multiple choice, recommended option first): unclear requirements,
   sign-ins or tokens that expire overnight, when the user is back (the run's deadline), anything to avoid this time.
5. **Pre-flight.** Run the project's `preflight:` checks, plus:
   - Approval prompts must not block the run. Set your agent to allow what the run needs and deny what the rules
     forbid ([AGENT-NOTES.md](AGENT-NOTES.md)). Any prompt during the run waits until morning.
   - `bash "$S/keep-awake.sh" check`: a sleep blocker exists, your agent's process is found (or the user accepts the
     time cap alone), and the machine is on AC power if the profile requires it.
   - The `notify` channel works, and there is enough disk space.

   Fix what you can. Tell the user what you can't, before they leave.
6. **Activate.** Create the run log from [templates/run-log.md](templates/run-log.md), create the run branch, then:

   ```bash
   bash "$S/keep-awake.sh" start --hours <keep_awake.max_hours>   # add --name "<keep_awake.agent_names>" if set
   # ends with your agent's process, at the cap, or on stop, whichever comes first
   ```

   Tell the user in one message: YOLO mode is active, the tasks, the deadline, what you will not do, and the log path.
   If `keep_awake.enabled` is false, skip the script and say so.

## 2. Run

- **No questions.** Don't ask the user anything or wait for a confirmation. Don't end your turn while work remains:
  in most agents, ending the turn ends the run. Wait for long jobs in the background if you can, or poll them.
- **Stay inside the rules.** Check every action with effects outside the working tree against git, `environments`
  (anything unlisted is off-limits), `outward` and the task's limits. The rules never grow during a run: if the
  work needs more, skip that part and report it.
- **Blocked or unclear:** apply `on_blocked`. `decide`: pick the most sensible option, log it with the alternative.
  `skip`: leave it, do the rest. `stop`: finish the current step safely, then report. A refused command is a no:
  take another allowed route or skip it, never retry the same command.
- **Done means done.** A task is done when the project's `definition_of_done` holds and the task's `verify` steps
  pass. Record their output.
- **Keep the log current** after each task and each decision taken alone. If your context gets compacted or
  summarized, re-read both rule files and the log before going on.
- **Respect the deadline.** Don't start what can't finish by then. Leave the work reviewable: committed on the run
  branch, nothing half-deployed.

## 3. Report

1. Finish the log: what's done, decisions taken alone (and the alternatives), what was skipped and why, the
   verification output, links (PRs, deploys, files), and what the user should look at first.
2. Send it through the profile's `notify` and post it as your final message.
3. `bash "$S/keep-awake.sh" stop`, and check that `status` says "not running".
