#!/usr/bin/env node
'use strict';
/**
 * Offline checks of the parts that need no browser or org: the file parsers, the sign-in inference, the video cut
 * points and the reply detection (against scripted chat states). Run after changing the scripts: node selftest.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readConversationFiles, resolveConversation } = require('./lib/conversations');
const { keepSegments } = require('./lib/media');
const { awaitReply } = require('./lib/surfaces');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afrec-selftest-'));
const write = (name, text) => { const p = path.join(tmp, name); fs.writeFileSync(p, text); return p; };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('markdown: front matter, steps, nested directives, multi-line message, escape, notes', () => {
  const file = write('Angela.md', [
    '---', 'surface: lightning', 'org: myOrg', 'user: angela.nakamura', 'app: c__App', '---',
    '# Title', 'A note that is ignored.', '',
    '1. Hi', '   - expect: Angela',
    '2. First line', '   second line', '',
    '3. click: "Confirm"', '4. wait: 2', '5. \\wait: this is a message', '- expect: /yes|no/',
  ].join('\n'));
  const [raw] = readConversationFiles([file], []);
  assert.deepEqual(raw.steps.map(s => s.type), ['message', 'expect', 'message', 'click', 'wait', 'message', 'expect']);
  assert.equal(raw.steps[2].text, 'First line\nsecond line');
  assert.equal(raw.steps[3].label, 'Confirm');
  assert.equal(raw.steps[5].text, 'wait: this is a message');
  const conv = resolveConversation(raw, {});
  assert.equal(conv.signIn, 'login-as');
  assert.equal(conv.identity, 'lightning|myOrg|angela.nakamura');
});

test('markdown: an unknown setting is an error', () => {
  const file = write('Typo.md', '---\nsit: https://x.example.com/\n---\n1. Hi\n');
  assert.throws(() => readConversationFiles([file], []), /unknown setting "sit"/);
});

test('csv: semicolons, quoted multi-line cell, grouping, inheritance, expect column', () => {
  const file = write('Sheet.csv', 'conversation;surface;site;user;message;expect\n'
    + 'Guest;messaging;https://x.example.com/s/;;Hi;\n'
    + ';;;;"Two lines\nhere";line\n'
    + 'Kavya;messaging;https://x.example.com/s/;kavya;Hi;\n');
  const warnings = [];
  const raws = readConversationFiles([file], warnings);
  assert.deepEqual(raws.map(r => r.name), ['Guest', 'Kavya']);
  assert.deepEqual(raws[0].steps.map(s => s.type), ['message', 'message', 'expect']);
  assert.equal(raws[0].steps[1].text, 'Two lines\nhere');
  const guest = resolveConversation(raws[0], {});
  assert.equal(guest.signIn, 'guest');
  assert.equal(guest.needsWarmup, false);
  assert.throws(() => resolveConversation(raws[1], {}), /Login-As to the site needs org/);
  assert.equal(resolveConversation(raws[1], { org: 'myOrg' }).signIn, 'login-as');
});

test('csv: two values of one setting in a conversation are an error', () => {
  const file = write('Conflict.csv', 'conversation,site,message\nA,https://a.example.com/,Hi\nA,https://b.example.com/,Hello\n');
  assert.throws(() => readConversationFiles([file], []), /two values for site/);
});

test('inference: warm-up, password, alias user', () => {
  const creds = write('creds.txt', 'u@x.com secret  (note)\n');
  const md = write('Warm.md', `---\nsite: https://x.example.com/\nuser: u\ncredentials: ${creds}\n---\n1. What are the quiet hours?\n`);
  const conv = resolveConversation(readConversationFiles([md], [])[0], {});
  assert.equal(conv.surface, 'messaging');
  assert.equal(conv.signIn, 'password');
  assert.equal(conv.needsWarmup, true);
  const alias = write('Alias.md', '---\napp: c__App\norg: myOrg\n---\n1. Hi\n');
  assert.equal(resolveConversation(readConversationFiles([alias], [])[0], {}).signIn, 'alias-user');
});

test('video cut: thinking shortened, waits kept to a second, segments merged and sorted', () => {
  const events = [
    { kind: 'ready', step: null, t: 10000 },
    { kind: 'start', step: 0, t: 11000 }, { kind: 'sent', step: 0, t: 13000 },
    { kind: 'first', step: 0, t: 25000 }, { kind: 'last', step: 0, t: 28000 },
    { kind: 'scroll', step: 0, t: 34000 }, { kind: 'read', step: 0, t: 37000 },
    { kind: 'start', step: 1, t: 38000 }, { kind: 'waitEnd', step: 1, t: 48000 },
    { kind: 'end', step: null, t: 50000 },
  ];
  const segments = keepSegments(events, 50000);
  const kept = segments.reduce((sum, [a, b]) => sum + b - a, 0);
  assert.ok(kept < 20000, `kept ${kept} ms`);
  assert.ok(segments.every(([a, b], i) => a < b && (i === 0 || segments[i - 1][1] < a)));
  assert.ok(!segments.some(([a, b]) => a < 20000 && b > 15000), 'the middle of the 12 s thinking pause is cut');
  assert.ok(segments.some(([a, b]) => a <= 38000 && b >= 39000) && !segments.some(([a, b]) => a < 45000 && b > 40000), 'a 10 s wait keeps one second');
});

/** A surface whose read() walks through scripted chat states, one per poll. */
function scripted(states) {
  let i = 0;
  return { read: async () => states[Math.min(i++, states.length - 1)] };
}
const chat = (messages, extra = {}) => ({ busy: false, busyText: '', busyWhy: '', events: [], messages, ...extra });
const U = text => ({ role: 'user', text });
const A = text => ({ role: 'agent', text });
const quick = { timeout: 20000, settle: 1000 };

test('reply: waits while busy, then returns the settled answer', async () => {
  const before = chat([A('Welcome'), U('Hi'), A('Hello')]);
  const s = scripted([chat([...before.messages, U('Q')]), chat([...before.messages, U('Q')], { busy: true }),
    chat([...before.messages, U('Q'), A('Part')]), chat([...before.messages, U('Q'), A('Part one, done')])]);
  const r = await awaitReply(s, before, quick);
  assert.equal(r.text, 'Part one, done');
});

test('reply: a late answer to the previous message stays out', async () => {
  const before = chat([U('Hi'), A('Welcome')]);
  const s = scripted([chat([U('Hi'), A('Welcome'), A('Late hello'), U('Q'), A('The answer')])]);
  assert.equal((await awaitReply(s, before, quick)).text, 'The answer');
});

test('reply: an answer whose bubble goes empty is kept and marked vanished', async () => {
  const before = chat([U('Hi'), A('Hello')]);
  const s = scripted([chat([U('Hi'), A('Hello'), U('Q'), A('Full answer')]), chat([U('Hi'), A('Hello'), U('Q'), A('')])]);
  const r = await awaitReply(s, before, { timeout: 30000, settle: 500 });
  assert.equal(r.text, 'Full answer');
  assert.equal(r.vanished, true);
});

test('reply: a hand-off to a human ends the wait within seconds, and says so', async () => {
  const before = chat([U('Hi'), A('Hello')]);
  const s = scripted([chat([U('Hi'), A('Hello'), U('Q')], { events: ['Leasing Assistant left'], busy: true, busyText: 'Transferring...' })]);
  const t0 = Date.now();
  const r = await awaitReply(s, before, { timeout: 60000, settle: 1000 });
  assert.ok(r.handoff && /left/.test(r.text), JSON.stringify(r));
  assert.ok(Date.now() - t0 < 20000);
});

test('markdown: type-from waits for a file and counts as a message', () => {
  const file = write('Code.md', '---\nsite: https://x.example.com/\n---\n1. Hi\n2. type-from: /tmp/afrec-code.txt\n   - expect: unlock\n');
  const conv = resolveConversation(readConversationFiles([file], [])[0], {});
  assert.deepEqual(conv.steps.map(s => s.type), ['message', 'message', 'expect']);
  assert.equal(conv.steps[1].fromFile, '/tmp/afrec-code.txt');
  assert.equal(conv.inputTimeout, 600000);
});

test('reply: a click with no answer returns null', async () => {
  const before = chat([U('Hi'), A('Hello')]);
  const r = await awaitReply(scripted([before]), before, { timeout: 30000, settle: 1000, optional: true });
  assert.equal(r, null);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`ok    ${t.name}`); } catch (e) { failed++; console.log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${tests.length - failed} of ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
