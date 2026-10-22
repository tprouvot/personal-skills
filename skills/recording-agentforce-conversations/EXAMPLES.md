# Examples

## Lightning, Login-As (no password needed)

```markdown
---
surface: lightning
org: myAdminAlias
user: angela.nakamura
app: c__PacificHavenProperties
hideLoginAsBanner: true       # optional: a clean header for a deck
---
# Weekly review

1. Hi
   - expect: Angela
2. Give me the weekly review of my buildings.
   - expect: occupan
```

## Lightning, password from a credentials file

```markdown
---
surface: lightning
org: myAdminAlias                       # gives the My Domain login page (or set loginUrl:)
user: daniel.brooks                     # a line of .local/ops-credentials.txt: "daniel.brooks@… <password>  (note)"
credentials: .local/ops-credentials.txt
path: /lightning/r/Account/001XXXXXXXXXXXXXXX/view   # open a record page instead of an app
---
1. Summarize this account.
```

## Lightning, the CLI user, from an sfdx auth URL

```markdown
---
surface: lightning
authUrl: .local/uat-auth-url.txt   # force://… ; authorized as the alias below before the run
org: uatRecorder
---
1. What can you help me with?
```

## Embedded Messaging, guest visitor

```markdown
---
surface: messaging
site: https://example.my.site.com/portal/
viewport: mobile          # the widget full screen, as on a phone
record: [gif]             # only the GIF
---
1. Hi
2. Do you have 2-bedroom apartments available in Portland?
   - expect: /\$\d/
```

## Embedded Messaging, community user via Login-As

```markdown
---
surface: messaging
site: https://example.my.site.com/portal/
org: myAdminAlias           # its admin logs in to the site as the user
user: kavya.patel
network: Pacific Haven      # only when the user belongs to several sites
---
1. Hi
2. What are the quiet hours in my building?
   - expect: quiet
3. click: /yes/             # a quick reply or confirmation card
4. wait: 3
```

## Embedded Messaging, community user with a password

```markdown
---
surface: messaging
site: https://example.my.site.com/portal/
user: hui.chen
credentials: .local/persona-credentials.txt
loginUrl: https://example.my.site.com/portal/login   # default: <site>login
---
1. Hi
```

## CSV: several conversations in one sheet

Settings are given once per conversation; blank cells inherit them. `expect` checks the answer to that row.

```csv
conversation,surface,org,user,app,site,message,expect
AngelaWeekly,lightning,myAdminAlias,angela.nakamura,c__PacificHavenProperties,,Hi,Angela
AngelaWeekly,,,,,,Give me the weekly review of my buildings.,occupan
DanielWeekly,lightning,myAdminAlias,daniel.brooks,c__PacificHavenProperties,,Give me the weekly review of my buildings.,Portland
Guest,messaging,,,,https://example.my.site.com/portal/,Hi,
Guest,,,,,,"Any pet-friendly apartments?
Two cats, if that matters.",pet
```

`AngelaWeekly`, `DanielWeekly` and `Guest` run in parallel. A second conversation for Angela would wait for the
first. The last message spans two lines (quoted cell) and is typed with Shift+Enter between them.

## Commands

```bash
S=~/.claude/skills/recording-agentforce-conversations/scripts
node "$S/record.js" tests/conversations --dry-run
node "$S/record.js" tests/conversations --parallel 4 --out .local/recordings/demo
node "$S/record.js" sheet.csv --only AngelaWeekly --headed            # watch one conversation
node "$S/record.js" questions.csv --org myAdminAlias --surface lightning --app c__MyApp --record screenshots
```
