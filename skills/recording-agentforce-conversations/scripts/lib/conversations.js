'use strict';
/**
 * Reads conversation files and turns them into validated, fully resolved conversations.
 *
 * Markdown (.md): one conversation per file. YAML front matter holds the settings; every top-level list item
 * (`1.` or `-`) is one step, indented lines continue it (multi-line message), anything else is a note.
 * CSV (.csv): one row per step. A `conversation` column groups rows (a blank cell continues the conversation
 * above); setting columns apply to their whole conversation, so a blank cell inherits the value given earlier.
 * An `expect` column checks the reply to that row's message.
 *
 * A step is a message, or a directive: `click: <label>`, `wait: <seconds>`, `expect: <regex>`, `type-from: <file>`.
 * A message that really starts with one of those words is written with a leading backslash.
 */
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const SETTING_KEYS = ['name', 'surface', 'org', 'authUrl', 'user', 'credentials', 'app', 'path', 'site', 'loginUrl',
  'network', 'viewport', 'record', 'fresh', 'warmup', 'hideLoginAsBanner', 'replyTimeout', 'settle', 'typeDelay', 'inputTimeout'];
const KEY_BY_LOWER = Object.fromEntries(SETTING_KEYS.map(k => [k.toLowerCase(), k]));
const GREETING = /^\s*(hi|hello|hey|hiya|good (morning|afternoon|evening)|bonjour|salut|hola|hallo|ciao)\b/i;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, scale: 2, mobile: false },
  mobile: { width: 390, height: 844, scale: 3, mobile: true },
};
const RECORD_KINDS = ['screenshots', 'video', 'gif'];

const canonicalKey = raw => KEY_BY_LOWER[String(raw).toLowerCase().replace(/[\s_-]/g, '')];

function parsePattern(value, where) {
  const literal = value.match(/^\/([\s\S]+)\/([dgimsuy]*)$/);
  try {
    const re = literal ? new RegExp(literal[1], literal[2]) : new RegExp(value, 'i');
    return { pattern: re.source, flags: re.flags.replace('g', ''), display: value };
  } catch (e) {
    if (literal) throw new Error(`${where}: invalid regular expression ${value}: ${e.message}`);
    const re = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return { pattern: re.source, flags: re.flags, display: value };
  }
}

function parseStep(raw, where) {
  const text = raw.trim();
  if (text.startsWith('\\')) return { type: 'message', text: text.slice(1), where };
  const m = text.match(/^(click|wait|expect|type-from)\s*:\s*([\s\S]*)$/i);
  if (!m) return { type: 'message', text, where };
  const value = m[2].trim();
  switch (m[1].toLowerCase()) {
    case 'click':
      if (!value) throw new Error(`${where}: "click:" needs the label of the button to press`);
      return { type: 'click', label: value.replace(/^["“'](.*)["”']$/, '$1'), where };
    case 'type-from':
      if (!value) throw new Error(`${where}: "type-from:" needs the path of the file to wait for`);
      return { type: 'message', fromFile: path.resolve(value), text: null, where };
    case 'wait': {
      const seconds = parseFloat(value);
      if (!(seconds >= 0)) throw new Error(`${where}: "wait:" needs a number of seconds, got "${value}"`);
      return { type: 'wait', seconds, where };
    }
    default:
      if (!value) throw new Error(`${where}: "expect:" needs a pattern`);
      return { type: 'expect', ...parsePattern(value, where), where };
  }
}

const DIRECTIVE_LINE = /^\s*(?:(?:\d+[.)]|[-*+])\s+)?((?:click|wait|expect|type-from)\s*:.*)$/i;

function parseMarkdown(text, file) {
  let settings = {};
  let body = text.replace(/^\uFEFF/, '');
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (fm) {
    let parsed;
    try { parsed = YAML.parse(fm[1]); } catch (e) { throw new Error(`${file}: invalid front matter: ${e.message}`); }
    settings = canonicalSettings(parsed || {}, file);
    body = body.slice(fm[0].length);
  }
  const offset = fm ? fm[0].split(/\r?\n/).length - 1 : 0;
  const raw = [];
  let current = null;
  let blank = false;
  body.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, '')).split(/\r?\n/).forEach((line, i) => {
    const where = `${file}:${i + 1 + offset}`;
    const item = line.match(/^ {0,3}(?:\d+[.)]|[-*+])\s+(.*)$/);
    if (item) {
      current = { lines: [item[1]], where };
      raw.push(current);
      blank = false;
    } else if (!line.trim()) {
      if (current) blank = true;
    } else if (current && /^(\s{2,}|\t)/.test(line)) {
      const directive = line.match(DIRECTIVE_LINE);
      if (directive) {
        raw.push({ lines: [directive[1]], where });
        current = { lines: [], where, closed: true };
      } else if (!current.closed) {
        if (blank) current.lines.push('');
        current.lines.push(line.replace(/^(\t| {2,4})/, ''));
      }
      blank = false;
    } else {
      current = null; // a heading or a paragraph ends the step above it
      blank = false;
    }
  });
  const steps = raw.filter(r => r.lines.length).map(r => parseStep(r.lines.join('\n'), r.where));
  return [{ name: settings.name || path.parse(file).name, file, settings, steps }];
}

function canonicalSettings(obj, where) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = canonicalKey(k);
    if (!key) throw new Error(`${where}: unknown setting "${k}" (known: ${SETTING_KEYS.join(', ')})`);
    out[key] = v;
  }
  return out;
}

function parseCsvRows(text) {
  text = text.replace(/^\uFEFF/, '');
  const head = text.split(/\r?\n/, 1)[0];
  const delimiter = (head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
      if (c === '\n') line++;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push({ cells: row, line: rowLine });
      row = [];
      field = '';
      rowLine = ++line;
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push({ cells: row, line: rowLine }); }
  return rows.filter(r => r.cells.some(f => f.trim() !== ''));
}

function parseCsv(text, file, warnings) {
  const rows = parseCsvRows(text);
  if (!rows.length) throw new Error(`${file}: the CSV is empty`);
  const header = rows[0].cells.map(h => h.trim());
  const columns = header.map(h => {
    const l = h.toLowerCase().replace(/[\s_-]/g, '');
    return ['conversation', 'message', 'expect'].includes(l) ? l : canonicalKey(h) || null;
  });
  const ignored = header.filter((h, i) => h && !columns[i]);
  if (ignored.length) warnings.push(`${file}: ignoring column(s) ${ignored.join(', ')}`);
  if (!columns.includes('message')) throw new Error(`${file}: the CSV needs a "message" column`);
  const fallbackName = path.parse(file).name;
  const conversations = new Map();
  let current = null;
  for (const { cells, line } of rows.slice(1)) {
    const where = `${file}:${line}`;
    const cell = key => { const i = columns.indexOf(key); return i >= 0 ? (cells[i] || '') : ''; };
    const id = cell('conversation').trim() || (current ? current.name : fallbackName);
    if (!conversations.has(id)) conversations.set(id, { name: id, file, settings: {}, steps: [] });
    current = conversations.get(id);
    columns.forEach((key, i) => {
      if (!key || ['conversation', 'message', 'expect'].includes(key)) return;
      const value = (cells[i] || '').trim();
      if (!value) return;
      if (current.settings[key] === undefined) current.settings[key] = value;
      else if (String(current.settings[key]) !== value) {
        throw new Error(`${where}: conversation "${id}" has two values for ${key}: "${current.settings[key]}" and "${value}"`);
      }
    });
    if (cell('message').trim()) current.steps.push(parseStep(cell('message'), where));
    if (cell('expect').trim()) current.steps.push({ type: 'expect', ...parsePattern(cell('expect').trim(), where), where });
  }
  return [...conversations.values()];
}

/** Reads every file (a directory means its .md and .csv files) and returns the raw conversations. */
function readConversationFiles(inputs, warnings) {
  const files = [];
  for (const input of inputs) {
    if (!fs.existsSync(input)) throw new Error(`no such file: ${input}`);
    if (fs.statSync(input).isDirectory()) {
      fs.readdirSync(input).filter(f => /\.(md|csv)$/i.test(f)).sort().forEach(f => files.push(path.join(input, f)));
    } else {
      files.push(input);
    }
  }
  if (!files.length) throw new Error('no conversation file given (.md or .csv)');
  const conversations = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (/\.csv$/i.test(file)) conversations.push(...parseCsv(text, file, warnings));
    else if (/\.(md|markdown)$/i.test(file)) conversations.push(...parseMarkdown(text, file));
    else throw new Error(`${file}: expected a .md or .csv file`);
  }
  return conversations;
}

const asBool = (v, key, where) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  if (/^(true|yes|y|1|on)$/i.test(String(v))) return true;
  if (/^(false|no|n|0|off)$/i.test(String(v))) return false;
  throw new Error(`${where}: ${key} must be true or false, got "${v}"`);
};
const asNumber = (v, key, where) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${where}: ${key} must be a positive number, got "${v}"`);
  return n;
};

function resolveFile(value, conversationFile, key) {
  const candidates = [path.resolve(String(value)), path.resolve(path.dirname(conversationFile), String(value))];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error(`${conversationFile}: ${key} file not found: ${value}`);
  return found;
}

function parseViewport(v, where) {
  const key = String(v || 'desktop').toLowerCase();
  if (VIEWPORTS[key]) return { name: key, ...VIEWPORTS[key] };
  const m = key.match(/^(\d{3,4})x(\d{3,4})$/);
  if (!m) throw new Error(`${where}: viewport must be desktop, mobile or WIDTHxHEIGHT, got "${v}"`);
  return { name: key, width: Number(m[1]), height: Number(m[2]), scale: 2, mobile: false };
}

function parseRecord(v, where) {
  if (v === undefined || v === null || v === '' || v === 'all') return { screenshots: true, video: true, gif: true };
  const list = (Array.isArray(v) ? v : String(v).split(/[\s,;+]+/)).map(x => String(x).trim().toLowerCase()).filter(Boolean);
  const out = { screenshots: false, video: false, gif: false };
  for (const item of list) {
    const kind = { screenshot: 'screenshots', png: 'screenshots', mp4: 'video', videos: 'video', gifs: 'gif' }[item] || item;
    if (kind === 'none') continue;
    if (!RECORD_KINDS.includes(kind)) throw new Error(`${where}: record accepts ${RECORD_KINDS.join(', ')}, got "${item}"`);
    out[kind] = true;
  }
  return out;
}

/** Applies defaults (command-line flags), infers the surface and the sign-in method, and validates. */
function resolveConversation(raw, defaults) {
  const where = raw.file;
  const s = { ...defaults, ...raw.settings };
  const conv = { name: String(s.name || raw.name), file: raw.file, steps: raw.steps };

  const surface = String(s.surface || (s.site ? 'messaging' : (s.app || s.path) ? 'lightning' : '')).toLowerCase();
  if (['lightning', 'panel', 'agentforce'].includes(surface)) conv.surface = 'lightning';
  else if (['messaging', 'widget', 'miaw', 'site', 'embedded', 'experience'].includes(surface)) conv.surface = 'messaging';
  else throw new Error(`${where}: set surface: lightning or surface: messaging (or give app: / site:)`);

  conv.org = s.org ? String(s.org) : undefined;
  conv.authUrl = s.authUrl ? resolveFile(s.authUrl, where, 'authUrl') : undefined;
  conv.user = s.user ? String(s.user).trim() : undefined;
  conv.credentials = s.credentials ? resolveFile(s.credentials, where, 'credentials') : undefined;
  conv.app = s.app ? String(s.app) : undefined;
  conv.path = s.path ? String(s.path) : undefined;
  conv.site = s.site ? String(s.site) : undefined;
  conv.loginUrl = s.loginUrl ? String(s.loginUrl) : undefined;
  conv.network = s.network ? String(s.network) : undefined;
  conv.viewport = parseViewport(s.viewport, where);
  conv.record = parseRecord(s.record, where);
  conv.fresh = asBool(s.fresh, 'fresh', where) !== false;
  conv.hideLoginAsBanner = asBool(s.hideLoginAsBanner, 'hideLoginAsBanner', where) === true;
  conv.replyTimeout = (asNumber(s.replyTimeout, 'replyTimeout', where) || 180) * 1000;
  conv.settle = (asNumber(s.settle, 'settle', where) || 5) * 1000;
  conv.inputTimeout = (asNumber(s.inputTimeout, 'inputTimeout', where) || 600) * 1000;
  const typeDelay = asNumber(s.typeDelay, 'typeDelay', where);
  conv.typeDelay = typeDelay === undefined ? 35 : typeDelay;
  const warmup = s.warmup === undefined || s.warmup === null ? '' : String(s.warmup).trim();
  conv.warmup = /^(false|no|off|0)$/i.test(warmup) ? false : /^(true|yes|on|1)?$/i.test(warmup) ? 'Hi' : warmup;

  if (conv.authUrl && !conv.org) conv.org = 'afrec-' + path.parse(conv.authUrl).name.replace(/[^A-Za-z0-9]/g, '');
  if (conv.surface === 'lightning') {
    if (!conv.org && !(conv.credentials && conv.loginUrl)) throw new Error(`${where}: a Lightning conversation needs org: (a sf alias) or authUrl:`);
    conv.signIn = conv.user && conv.credentials ? 'password' : conv.user ? 'login-as' : 'alias-user';
    if (conv.viewport.mobile) throw new Error(`${where}: the Lightning panel needs a desktop viewport`);
  } else {
    if (!conv.site) throw new Error(`${where}: a messaging conversation needs site: (the page where the chat widget loads)`);
    try { new URL(conv.site); } catch (e) { throw new Error(`${where}: site is not a URL: ${conv.site}`); }
    conv.signIn = !conv.user ? 'guest' : conv.credentials ? 'password' : 'login-as';
    if (conv.signIn === 'login-as' && !conv.org) throw new Error(`${where}: Login-As to the site needs org: (the admin sf alias), or give credentials:`);
  }
  if (conv.hideLoginAsBanner && !(conv.surface === 'lightning' && conv.signIn === 'login-as')) conv.hideLoginAsBanner = false;

  if (!conv.steps.some(st => st.type === 'message' || st.type === 'click')) throw new Error(`${where}: "${conv.name}" has no message to send`);
  const firstExchange = conv.steps.findIndex(st => st.type === 'message' || st.type === 'click');
  const earlyExpect = conv.steps.findIndex(st => st.type === 'expect');
  if (earlyExpect >= 0 && earlyExpect < firstExchange) throw new Error(`${conv.steps[earlyExpect].where}: "expect:" comes before any message`);
  const first = conv.steps[firstExchange];
  conv.needsWarmup = conv.surface === 'messaging' && conv.warmup !== false && !(first.type === 'message' && GREETING.test(first.text || ''));

  const host = conv.surface === 'lightning' ? conv.org || conv.loginUrl : new URL(conv.site).host;
  conv.identity = `${conv.surface}|${host}|${conv.signIn === 'guest' ? 'guest:' + conv.name : conv.user || 'alias-user'}`;
  return conv;
}

module.exports = { readConversationFiles, resolveConversation, SETTING_KEYS };
