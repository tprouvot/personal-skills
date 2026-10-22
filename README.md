# personal-skills

My custom Claude Code skills.

| Skill | What it does |
| --- | --- |
| [recording-agentforce-conversations](skills/recording-agentforce-conversations/SKILL.md) | Plays scripted Agentforce conversations in a real browser and records screenshots, an MP4, a GIF and a transcript |

## Install

Each skill is symlinked into `~/.claude/skills`, so edits made there land in this repo:

```sh
ln -s ~/Repo/personal-skills/skills/<skill> ~/.claude/skills/<skill>
```

Skills with a `scripts/package.json` need their dependencies installed once:

```sh
cd skills/<skill>/scripts && npm install
```

`recording-agentforce-conversations` also needs Playwright's Chromium: `npx playwright install chromium` in its `scripts/`.
