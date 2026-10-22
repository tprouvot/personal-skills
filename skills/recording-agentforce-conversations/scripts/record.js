#!/usr/bin/env node
'use strict';
/**
 * Plays scripted Agentforce conversations in a real browser and records them: a screenshot of the chat per reply,
 * a raw WebM, an MP4 and a GIF with the agent's thinking cut short, a transcript per conversation and a run report.
 * Conversations run in parallel; two with the same identity (surface, org or site, user) never overlap.
 *
 * Usage: node record.js <conversation.md|.csv|folder ...> [options]   (node record.js --help)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readConversationFiles, resolveConversation } = require('./lib/conversations');

const HELP = `Usage: node record.js <conversation.md|.csv|folder ...> [options]

Defaults for the settings a file leaves out (the file wins):
  --org <alias>                 sf alias: Lightning, the Login-As admin, the My Domain of password logins
  --surface <lightning|messaging>
  --app <app> | --path <path>   Lightning page to open (default: home)
  --site <url>                  page where the Embedded Messaging widget loads
  --user <user>                 username, the part before the @, or full name
  --credentials <file>          "username password" lines: password login instead of Login-As
  --network <name|id>           Experience site, when a community user belongs to several
  --login-url <url>             login page for password logins
  --auth-url <file>             sfdx auth URL file, authorized as --org (or a derived alias) first
  --viewport <desktop|mobile|WxH>
  --record <screenshots,video,gif>
  --reply-timeout <s>   --settle <s>   --type-delay <ms>   --warmup <text|false>
  --hide-login-as-banner        --no-fresh

Run:
  --parallel <n>                conversations at once (default 3)
  --out <dir>                   output folder (default .local/recordings/<date-time>)
  --only <name,...>             run only these conversations
  --headed                      show the browsers
  --dry-run                     check the files and print the plan; opens nothing
`;

const SETTING_FLAGS = {
  org: 'org', surface: 'surface', app: 'app', path: 'path', site: 'site', user: 'user', credentials: 'credentials',
  network: 'network', 'login-url': 'loginUrl', 'auth-url': 'authUrl', viewport: 'viewport', record: 'record',
  'reply-timeout': 'replyTimeout', settle: 'settle', 'type-delay': 'typeDelay', warmup: 'warmup',
};

function parseArgs(argv) {
  const files = [];
  const defaults = {};
  const run = { parallel: 3, out: null, only: null, headed: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { process.stdout.write(HELP); process.exit(0); }
    if (!arg.startsWith('--')) { files.push(arg); continue; }
    const eq = arg.indexOf('=');
    const key = arg.slice(2, eq > 0 ? eq : undefined);
    const value = () => {
      if (eq > 0) return arg.slice(eq + 1);
      if (i + 1 >= argv.length) throw new Error(`--${key} needs a value`);
      return argv[++i];
    };
    if (SETTING_FLAGS[key]) defaults[SETTING_FLAGS[key]] = value();
    else if (key === 'hide-login-as-banner') defaults.hideLoginAsBanner = true;
    else if (key === 'no-fresh') defaults.fresh = false;
    else if (key === 'parallel') run.parallel = Math.max(1, parseInt(value(), 10) || 1);
    else if (key === 'out') run.out = value();
    else if (key === 'only') run.only = value().split(',').map(s => s.trim()).filter(Boolean);
    else if (key === 'headed') run.headed = true;
    else if (key === 'dry-run') run.dryRun = true;
    else throw new Error(`unknown option --${key} (see --help)`);
  }
  return { files, defaults, run };
}

const timestamp = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

function assignFolders(conversations) {
  const used = new Set();
  for (const c of conversations) {
    const base = c.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'conversation';
    let folder = base;
    for (let k = 2; used.has(folder.toLowerCase()); k++) folder = `${base}-${k}`;
    used.add(folder.toLowerCase());
    c.folder = folder;
  }
}

function printPlan(conversations, run) {
  console.log(`${conversations.length} conversation(s), up to ${run.parallel} at a time${run.out ? `, into ${run.out}` : ''}:`);
  const width = Math.max(...conversations.map(c => c.name.length));
  for (const c of conversations) {
    const where = c.surface === 'lightning' ? `${c.org || c.loginUrl} ${c.path || (c.app ? 'app ' + c.app : 'home')}` : c.site;
    const who = c.signIn === 'guest' ? 'guest' : c.signIn === 'alias-user' ? `CLI user of ${c.org}` : `${c.user} (${c.signIn})`;
    const record = Object.entries(c.record).filter(([, on]) => on).map(([k]) => k).join('+') || 'transcript only';
    const steps = c.steps.map(s => s.type).reduce((acc, t) => ({ ...acc, [t]: (acc[t] || 0) + 1 }), {});
    console.log(`  ${c.name.padEnd(width)}  ${c.surface.padEnd(9)} ${who}  @ ${where}`);
    console.log(`  ${''.padEnd(width)}  ${Object.entries(steps).map(([t, k]) => `${k} ${t}`).join(', ')}; ${record}; ${c.viewport.name}`
      + `${c.needsWarmup ? `; warm-up "${c.warmup}"` : ''}${c.fresh ? '' : '; keeps an open chat'}${c.hideLoginAsBanner ? '; hides the Login-As banner' : ''}`);
  }
  const groups = {};
  conversations.forEach(c => { (groups[c.identity] = groups[c.identity] || []).push(c.name); });
  const queued = Object.values(groups).filter(g => g.length > 1);
  if (queued.length) console.log(`Same identity, run one after the other: ${queued.map(g => g.join(' -> ')).join('; ')}`);
}

function warnIfNotIgnored(out) {
  try {
    execFileSync('git', ['check-ignore', '-q', out], { stdio: 'ignore' });
  } catch (e) {
    if (e.status === 1) console.warn(`warning: ${out} is not ignored by git, and recordings show org data: add it to .gitignore`);
  }
}

/** Runs `worker` on every item, `limit` at a time, never two items with the same identity at once. */
function pool(items, limit, worker) {
  const results = new Array(items.length);
  const waiting = items.map((item, index) => ({ item, index }));
  const busy = new Set();
  let running = 0;
  return new Promise(resolve => {
    const pump = () => {
      if (!waiting.length && !running) { resolve(results); return; }
      while (running < limit) {
        const next = waiting.findIndex(w => !busy.has(w.item.identity));
        if (next < 0) break;
        const { item, index } = waiting.splice(next, 1)[0];
        busy.add(item.identity);
        running++;
        worker(item)
          .then(r => { results[index] = r; }, e => { results[index] = { name: item.name, folder: item.folder, file: item.file, surface: item.surface, signIn: item.signIn, who: null, status: 'failed', exchanges: [], flags: [], warnings: [], outputs: [], error: e.message, durationMs: 0 }; })
          .finally(() => { busy.delete(item.identity); running--; pump(); });
      }
    };
    pump();
  });
}

async function main() {
  const { files, defaults, run } = parseArgs(process.argv.slice(2));
  const warnings = [];
  const raw = readConversationFiles(files, warnings);
  const errors = [];
  let conversations = [];
  for (const r of raw) {
    try { conversations.push(resolveConversation(r, defaults)); } catch (e) { errors.push(e.message); }
  }
  warnings.forEach(w => console.warn('warning: ' + w));
  if (errors.length) {
    errors.forEach(e => console.error('error: ' + e));
    process.exit(2);
  }
  if (run.only) {
    const missing = run.only.filter(n => !conversations.some(c => c.name === n));
    if (missing.length) throw new Error(`--only: no conversation named ${missing.join(', ')}`);
    conversations = conversations.filter(c => run.only.includes(c.name));
  }
  assignFolders(conversations);
  run.out = path.resolve(run.out || path.join('.local', 'recordings', timestamp()));
  if (run.dryRun) { printPlan(conversations, run); return 0; }

  fs.mkdirSync(run.out, { recursive: true });
  warnIfNotIgnored(run.out);
  const { loginSfdxUrl } = require('./lib/salesforce');
  const authorized = new Set();
  for (const c of conversations.filter(x => x.authUrl)) {
    const key = c.authUrl + '|' + c.org;
    if (authorized.has(key)) continue;
    console.log(`authorizing ${c.org} from ${path.basename(c.authUrl)}`);
    await loginSfdxUrl(c.authUrl, c.org);
    authorized.add(key);
  }

  const { chromium } = require('playwright');
  const { runConversation } = require('./lib/player');
  const { writeRunReport } = require('./lib/report');
  const browser = await chromium.launch({ headless: !run.headed });
  const close = () => browser.close().catch(() => {}).then(() => process.exit(130));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let results;
  try {
    results = await pool(conversations, run.parallel, conv => runConversation(browser, conv, run));
  } finally {
    await browser.close().catch(() => {});
  }
  writeRunReport(results, { startedAt, durationMs: Date.now() - t0, out: run.out, parallel: run.parallel });
  const failed = results.filter(r => r.status === 'failed').length;
  const flagged = results.filter(r => r.status === 'flagged').length;
  console.log(`\n${results.length - failed} of ${results.length} recorded${flagged ? `, ${flagged} flagged` : ''}${failed ? `, ${failed} failed` : ''}. Report: ${path.join(run.out, 'report.md')}`);
  return failed ? 1 : 0;
}

main().then(code => process.exit(code), e => { console.error('error: ' + e.message); process.exit(2); });
