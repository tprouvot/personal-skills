---
name: recording-agentforce-conversations
description: Plays scripted Agentforce conversations in a real browser and records a screenshot of the chat per reply, an MP4 and a GIF with the agent's thinking pauses cut, and a transcript, running several conversations in parallel. Covers the Lightning Agentforce panel (internal users via the sf CLI alias, Login-As or a password file) and Embedded Messaging widgets on Experience Cloud sites (community users via Login-As or password, or guests). Use when the user wants screenshots, a video, a GIF or a demo recording of an Agentforce conversation, or wants to replay a discussion written in a .md or .csv file.
---

# Recording Agentforce conversations

`scripts/record.js` (Playwright with its own Chromium, plus ffmpeg-static) plays each conversation in an isolated
browser context. It signs in off camera, types every message like a person and waits for each answer. Then it writes
one folder per conversation: a chat-cropped PNG per reply, `conversation.mp4`/`.gif`/`.webm`, and `transcript.md`.

## Quick start

```bash
S=~/.claude/skills/recording-agentforce-conversations/scripts
[ -d "$S/node_modules" ] || (cd "$S" && npm install)   # once (ffmpeg-static is pre-approved in package.json)
node "$S/record.js" path/to/conversations --dry-run    # parse, show sign-in methods and the queue, open nothing
node "$S/record.js" path/to/conversations              # record, 3 at a time, into .local/recordings/<date-time>/
```

```markdown
---
surface: lightning
org: myAlias                    # sf alias
user: angela.nakamura           # Login-As from the alias's admin (add credentials: for a password login)
app: c__PacificHavenProperties
---
1. Hi
   - expect: Angela
2. Give me the weekly review of my buildings.
```

## Who gets signed in

| Settings | Sign-in |
| --- | --- |
| `org`, no `user` | the alias's own user (frontdoor URL) |
| `org` + `user` | Login-As by the alias's admin (Lightning, or the community user's site) |
| `user` + `credentials` | the login form, with `username password` from that file |
| `site`, no `user` | guest visitor |
| `authUrl` | `sf org login sfdx-url` to the `org` alias first, then as above |

## Workflow

1. **Gather** the agent, where it runs (a Lightning app, or the URL of the page carrying the widget), who is signed
   in, and the messages. Reuse or write `.md`/`.csv` files: settings, directives and CSV rules are in
   [REFERENCE.md](REFERENCE.md), ready-made files in [EXAMPLES.md](EXAMPLES.md).
2. **Check prerequisites.** `sf org display -o <alias>` connects; the agent has an active version
   (`SELECT BotDefinition.DeveloperName, VersionNumber, Status FROM BotVersion`); credential files exist. Never print
   passwords, frontdoor URLs or sfdx auth URLs.
3. **Dry run**, and show the user the plan (sign-in per conversation, which conversations queue behind each other).
4. **Warn about side effects** before recording. Every message spends agent credits and can run real actions
   (records created, emails, logs). Leave out flows that email codes or create records unless the user wants them.
5. **Record.** Run long batches in the background. `--parallel N` (default 3); conversations with the same identity
   (surface, org or site, user) never overlap, because a signed-in chat persists across visits.
6. **Review** `report.md`, then every `transcript.md`, and open a few PNGs to confirm they show what the transcript
   says. Report flagged `expect` checks, warnings and failures with the reason the script gave. A failed
   conversation keeps `error.png` (its last screen) and the raw `conversation.webm`.

## Outputs (per conversation folder)

- `00-open.png` / `99-end.png`: the full window when the chat is ready and at the end.
- `NN-<message>.png`: the chat only (panel or widget), at 2x, scrolled so the question is at the top.
- `conversation.mp4`: typing and answers at real speed, each thinking pause cut to about 1.5 s; `conversation.gif`:
  the same, cropped to the chat; `conversation.webm`: the raw recording.
- `transcript.md` (questions, answers, timings, expect results), `timeline.json` (cut points).
- The run folder adds `report.md` and `report.json`.

## Gotchas

- An inactive agent or a hand-off to a human ("Transferring...", "… left") means no answer: the script says so
  and stops that conversation. Check the agent's status before blaming the recorder.
- On Messaging the first message only opens the conversation (the welcome comes back). A file that doesn't start
  with a greeting gets a warm-up "Hi" first (`warmup:` changes or disables it).
- A password login that hits identity verification or a forced password change stops with an explanation; Login-As
  avoids both. During Login-As, Lightning shows a "Logged in as" banner (`hideLoginAsBanner: true` hides it).
- Everything else, including the selectors when Salesforce changes the chat markup: [REFERENCE.md](REFERENCE.md).
