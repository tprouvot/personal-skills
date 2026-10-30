# First-run setup

Build the missing file with the user before the first run. Detect first, then ask: don't ask anything the
machine or the repo can answer. Ask in batches of up to four multiple-choice questions, recommended option first, and
say why when a choice has consequences (what a merge triggers, what an environment is used for).

## Profile: `${XDG_CONFIG_HOME:-~/.config}/yolo-mode/profile.yaml` (once per machine)

Start from [templates/profile.yaml](templates/profile.yaml).

1. **Detect:**
   - `bash "$S/keep-awake.sh" check`: platform, sleep blocker, power source, agent process. With no blocker (Linux
     without systemd, an unknown platform), the user must set the power settings by hand. If your agent's process
     isn't found, add its binary name to `keep_awake.agent_names` ([AGENT-NOTES.md](AGENT-NOTES.md)).
   - Which agent you are, and how its approvals are set up ([AGENT-NOTES.md](AGENT-NOTES.md)).
2. **Ask:**
   - How to reach them at the end: Slack DM, email, desktop notification, a command (ntfy, Pushover, a webhook) or
     nothing. Look up the address or ID yourself (for example a Slack user search) and confirm it.
   - The longest run to keep the machine awake (`keep_awake.max_hours`, default 14; a weekend needs more).
   - Must the machine be on AC power? (Recommended for laptops: on battery or with the lid closed, it can still sleep.)
   - Rules for every project (`standing_rules`): what never to do anywhere. Suggest what you saw in their global
     instruction files (CLAUDE.md, AGENTS.md, GEMINI.md and the like) or your memory of them: no software installs,
     no customer environments, no messages to other people.
   - Default `on_blocked`: decide and log (recommended), skip, or stop.

## Project: `<project root>/.yolo-mode.yaml` (once per project)

Start from [templates/project.yaml](templates/project.yaml).

1. **Detect:**
   - Git: default branch, remote, `gh auth status` (or `glab`). CI that deploys on merge, tag or push: read
     `.github/workflows`, `.gitlab-ci.yml`, `Jenkinsfile`, `azure-pipelines.yml`, and say what each branch triggers.
   - What the agent can change from here: Salesforce orgs (`sf org list`), Kubernetes contexts, cloud profiles
     (AWS, GCP, Azure), database URLs in `.env*`, deploy CLIs (vercel, netlify, heroku, fly), published sites. List
     them. The rules allow only what is listed.
   - The project's criteria already written down: agent instruction files (AGENTS.md, CLAUDE.md, GEMINI.md,
     `.cursor/rules`, `.github/copilot-instructions.md`), CONTRIBUTING, test and lint commands
     (package.json, Makefile, pyproject, sfdx-project.json), docs the team keeps current, naming conventions.
   - Outward-facing tools available in this session: chat, email, issue trackers, docs and slides, publishing.
2. **Ask:**
   - Git: local commits only, branch + push + PR (recommended), or merging too.
   - Each environment (group similar ones): off-limits, read, write, or destructive (write plus deletes, drops,
     deactivations). Unlisted environments are off-limits; say so.
   - Outward actions allowed without asking, as a multi-select of what you detected.
   - `on_blocked`, if it differs from the profile.
   - Definition of done: confirm the detected test, lint and documentation rules, and add missing ones.
3. **Seed `tasks:`** with the kinds of work the user does here (recent commits, `scripts/`, the request at hand).
   Settle each new task as in step 3 of the brief (`grill-me`, or the same interview without it).
4. **Where the file lives:** local only (recommended, because it grants this user's permissions: add
   `.yolo-mode.yaml` to `.git/info/exclude`) or committed, so the team shares one set of limits.
5. Show the whole file, get a yes, and save it.

## Changing the rules later

The user can edit either file by hand, or ask to "update the YOLO rules": walk through the change the same way and
show the diff. During a run the files are read-only.
