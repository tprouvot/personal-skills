# Reference

## Command line

```text
node scripts/record.js <conversation.md|.csv|folder ...> [options]
```

A folder means every `.md` and `.csv` file in it. Options set defaults for whatever a file leaves out; the file wins.

| Option | Same as the setting |
| --- | --- |
| `--org`, `--surface`, `--app`, `--path`, `--site`, `--user`, `--credentials`, `--network`, `--viewport`, `--record`, `--warmup` | the setting of the same name |
| `--login-url`, `--auth-url`, `--reply-timeout`, `--settle`, `--type-delay` | `loginUrl`, `authUrl`, `replyTimeout`, `settle`, `typeDelay` |
| `--hide-login-as-banner`, `--no-fresh` | `hideLoginAsBanner: true`, `fresh: false` |
| `--parallel <n>` | conversations at once (default 3) |
| `--out <dir>` | run folder (default `.local/recordings/<date-time>`) |
| `--only <name,...>` | run only these conversations (names as in the dry run) |
| `--headed` | show the browser windows |
| `--dry-run` | validate and print the plan, open nothing |

Exit code: 0 when every conversation was recorded (flags included), 1 when one failed, 2 for a file or option error.

## Markdown files (one conversation)

- Optional YAML front matter between `---` lines holds the settings. An unknown key is an error, to catch typos.
- Every top-level list item (`1.`, `1)`, `-`, `*`) is one step, in order. Indented lines continue the item: a
  multi-line message is typed with Shift+Enter between lines.
- An indented `- expect: ...` (or `click:` / `wait:`) under a message is its own step, after that message.
- Headings, paragraphs and `<!-- comments -->` are notes and are ignored.
- The conversation is named after the file unless `name:` says otherwise.

## CSV files (one or many conversations)

- The first row is the header. `message` is required; `conversation`, `expect` and any setting are optional.
  Header names ignore case, spaces, `_` and `-` (`Login URL` = `loginUrl`). Other columns are ignored with a warning.
- One row is one step. A blank `conversation` cell continues the conversation above; without the column, the whole
  file is one conversation named after the file.
- A setting applies to its whole conversation: give it once, leave the other rows blank. Two different values for one
  conversation are an error.
- `expect` checks the answer to that row's message. A row with only an `expect` checks the previous answer.
- Comma or semicolon delimiter (detected from the header); RFC 4180 quoting, `""` for a quote, line breaks inside
  quotes allowed. A spreadsheet export works as is.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `surface` | `messaging` with `site`, `lightning` with `app`/`path` | `lightning` (panel) or `messaging` (widget) |
| `org` | | sf alias or username: Lightning org, Login-As admin, My Domain for password logins |
| `authUrl` | | file holding an sfdx auth URL; authorized as `org` (or `afrec-<file name>`) before the run |
| `user` | | username, the part before the @, or full name (`Angela Nakamura`) |
| `credentials` | | file of `username password  (note)` lines; makes the login a password login |
| `app` | | Lightning app API name, e.g. `c__PacificHavenProperties` |
| `path` | `/lightning/page/home` | any Lightning path, e.g. a record page; wins over `app` |
| `site` | | URL of the page where the Embedded Messaging widget loads |
| `loginUrl` | My Domain, or `<site>login` | login page for password logins |
| `network` | the user's only site | Experience Cloud site (name or Id) for Login-As, when the user belongs to several |
| `viewport` | `desktop` (1440x900 at 2x) | `mobile` (390x844 at 3x, Messaging only) or `WIDTHxHEIGHT` |
| `record` | `screenshots, video, gif` | any subset (`none` keeps only the transcript) |
| `fresh` | `true` | start clean: end a Messaging chat left open, clear the Lightning panel history |
| `warmup` | `Hi` | Messaging: greeting sent first when the first message isn't one; `false` to disable |
| `hideLoginAsBanner` | `false` | Lightning Login-As: hide the "Logged in as ... Log out" banner |
| `replyTimeout` | `180` | seconds to wait for an answer |
| `settle` | `5` | seconds without change that end an answer (at least 12 for the first Messaging exchange) |
| `typeDelay` | `35` | ms per key while a video is recorded (a long message still takes at most about 4.5 s); `0` pastes |

## Directives

| Step | Effect |
| --- | --- |
| `click: <label>` | presses the most recent visible button, link, menu item, option, radio, tab or checkbox whose name, `title` or `aria-label` contains the label (or matches `/regex/`), else matching text; waits up to 15 s for it to render, then for an answer if one starts within 15 s. In Lightning it only looks inside the Agentforce panel |
| `wait: <seconds>` | pauses; the MP4 keeps one second of it |
| `expect: <regex>` | soft check on the last answer: plain text is a case-insensitive regex (`occupan`, `yes|no`); `/.../flags` for a literal one. A mismatch is flagged in the transcript and the report; the run goes on |
| `\click: ...` | a message that really starts with a directive word |

The Lightning panel's suggestions and "Recommendations" are generated: their wording changes from one run to the
next, and sometimes there are none. Click them with a `/regex/` (`click: /weekly/`), or type the request instead.
Labels that are fixed in the UI, such as confirmation cards, quick replies and the reply's Copy icon, are safe.

## Sign-in

- **The alias's user:** `sf org open --url-only` gives a single-use frontdoor URL.
- **Login-As, internal user:** the alias's admin signs in, then opens
  `/servlet/servlet.su?oid=<org>&suorgadminid=<user>&retURL=…&targetURL=…`. The script waits until
  `$A.get('$SObjectType.CurrentUser.Id')` is that user. This needs "Administrators Can Log in as Any User"
  (Setup > Login Access Policies; `enableAdminLoginAsAnyUser` in the Security settings).
- **Login-As, community user:** the alias's admin opens
  `/servlet/servlet.su?oid=<org>&retURL=/<contact>&sunetworkid=<network>&sunetworkuserid=<user>`. The site comes
  from `NetworkMember`; the script waits for the browser to reach the `site` host.
- **Password:** the My Domain login page (`#username`, then `#password`, after `#Login` when login discovery asks
  for it), or the site's login page (the first email or username field, then the password field). An optional
  prompt after the login, such as "Register Your Mobile Phone", is skipped by going straight to Lightning. Only a
  code-entry page (`/_ui/identity/verification/…`, a verification code field) or a forced password change stops.
- **Guest:** nothing; every guest conversation is a new visitor.
- Sessions are never cached. Each conversation signs in again in a context that is not recorded, then hands its
  cookies and local storage to the recording context. Recordings therefore start on the app or the site, never on a
  login screen.
- **sfdx auth URL:** `sf org login sfdx-url --sfdx-url-file <file> --alias <org>`. Never `sf org logout` that
  alias afterwards: it revokes the refresh token that other aliases of the same username share.

## How an answer is detected

All three chat UIs (the Lightning panel, the newer Messaging widget and the classic one) use SLDS chat markup:

- The agent's text has `.slds-chat-message__text_inbound`; the user's has `.slds-chat-message__text_outbound`.
- The agent is busy while any of these is visible: `.has-progress-indicator`, an element whose tag contains
  `progress-indicator` or `typing`, or `.slds-icon-typing`.
- System events (joined, left, ended) are `.slds-chat-event`, `.slds-chat-listitem_event`, or `system-event` /
  `system-message` elements.

Before each message, the script waits until the chat is quiet. After sending, the answer is every agent message below
the user's new bubble, once the agent is not busy and nothing has changed for `settle` seconds. A message the agent
revises in place is recorded in its final form. A new "left / transferred / ended" event, or a "Transferring..."
indicator, with no answer for 10 s ends the conversation: the agent handed it off and no answer will come.

## How the video is cut

`timeline.json` records, per step, when typing started, when the message was sent, when the first and the last
change of the answer happened, and when the answer was scrolled to its question. The MP4 keeps:

- the last 1.5 s before the chat is ready;
- typing, and 0.6 s after sending;
- 0.75 s at each end of the thinking pause (the middle is cut);
- the answer arriving;
- a reading pause of 2 to 5 s on the answer, scrolled so its question is at the top;
- the last 1.2 s.

The GIF is that MP4 at 10 fps, cropped to the chat (the panel's `.slds-panel`, or the widget's iframe) and at most
480 px wide. The raw `.webm` keeps everything, including the waits.

## Surfaces

**Lightning panel:**

- Opens `path`, `app` or home, then the header button named "Agentforce", unless the panel is already open.
- Clicks through the "Got It" first-use screens, then waits for `textarea.chat-box`.
- The crop is the `.slds-panel` that holds `div.einstein-assistant-container`.
- `fresh` presses "Clear history" when the panel already shows user messages.

**Embedded Messaging:**

- Everything lives in `iframe#embeddedMessagingFrame`.
- The launcher is either `button.chat-fab-container` inside the frame (newer widget, often labelled "Ask Me
  Anything" but named "Start with text") or `#embeddedMessagingConversationButton` in the page (classic widget). The
  script waits for whichever appears first.
- `fresh` (signed-in users only): open the chat menu ("Open the chat menu" or `.header-menu-button`), click "End
  chat", confirm, then "New Conversation". The classic widget's "Start a new chat..." placeholder means nothing is open.
- A verified user's history stays visible above the new conversation; only messages after the send count.

When Salesforce changes this markup, run with `--headed` (or open the page with Chrome DevTools MCP), inspect the
chat, and update the selectors at the top of `scripts/lib/surfaces.js`. After any change to the scripts, run
`node scripts/selftest.js`. It checks the parsers, the sign-in inference, the video cut points and the reply
detection offline, against scripted chat states.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `no Embedded Messaging launcher` | the deployment isn't published, its agent is inactive, or the site doesn't load the widget for this user |
| `the agent handed the conversation off` | the agent escalated, often because an action failed (check the agent user's permission sets), or Omni-Channel routed it to a queue |
| `no reply within N s` | the agent is inactive or slow: check `BotVersion.Status`, raise `replyTimeout` |
| `Login-As was refused` / Login-As never completes | turn on "Administrators Can Log in as Any User"; the alias must be an admin |
| `verify their identity` / `change their password` | use Login-As (drop `credentials:`), trust the IP range in the profile, or sign in once by hand |
| `no Agentforce button in the Lightning header` | the user lacks the agent's access permission set, or Agentforce is off |
| `is an Experience Cloud user` / `is an internal user` | wrong `surface` for that user |
| Chromium missing | `npx playwright install chromium` in `scripts/` |
| `ffmpeg:` errors, or no `ffmpeg-static` binary | `npm rebuild ffmpeg-static` in `scripts/` (its download is allowed in `package.json`), or set `FFMPEG_PATH` |

## Limits

- A reply screenshot shows as much of a long answer as fits in the chat; the transcript has the full text, and the
  video shows it scrolling in.
- Cards and tables appear as text in the transcript.
- On Messaging, the first exchange can bring back the welcome, an answer, or both; the transcript keeps what came
  after the user's bubble.
