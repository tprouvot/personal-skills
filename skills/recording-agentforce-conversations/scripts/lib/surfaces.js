'use strict';
/**
 * The chat surfaces. All of them use SLDS chat markup, so one reader serves every variant: the agent's text carries
 * `slds-chat-message__text_inbound`, the user's `slds-chat-message__text_outbound`, and a visible progress or typing
 * indicator means the agent is still working.
 *
 *   Lightning  the Agentforce side panel of a Lightning app (runtime_copilot components)
 *   Messaging  Embedded Messaging in iframe#embeddedMessagingFrame: the newer widget (its launcher,
 *              button.chat-fab-container, lives inside the frame) or the classic one (#embeddedMessagingConversationButton)
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- functions evaluated inside the page (no closures) ----

function readChatInPage() {
  const shown = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let root = window.__afrecRoot && window.__afrecRoot.isConnected ? window.__afrecRoot : null;
  if (!root) {
    const find = node => {
      for (const el of node.children) {
        if (el.tagName.toLowerCase() === 'runtime_copilot_base-assistant-panel' || (el.classList && el.classList.contains('einstein-assistant-container'))) return el;
        const hit = find(el) || (el.shadowRoot && find(el.shadowRoot));
        if (hit) return hit;
      }
      return null;
    };
    root = find(document.body);
    if (root) window.__afrecRoot = root;
  }
  const messages = [];
  const events = [];
  let busy = !!(root && root.classList.contains('has-progress-indicator'));
  let busyText = '';
  let busyWhy = root && busy ? 'has-progress-indicator' : '';
  const walk = (node, inside) => {
    for (const el of node.children) {
      const cl = el.classList;
      const tag = el.tagName.toLowerCase();
      const cls = typeof el.className === 'string' ? el.className : '';
      let item = false;
      if (!inside && cl && cl.contains('slds-chat-message__text_inbound')) { messages.push({ role: 'agent', text: el.innerText.trim() }); item = true; }
      else if (!inside && cl && cl.contains('slds-chat-message__text_outbound')) { messages.push({ role: 'user', text: el.innerText.trim() }); item = true; }
      else if (!inside && (/(^|\s)slds-chat-(event|listitem_event)(\s|$)|system-(event|message)/.test(cls) || /system-(event|message)|chat-event/.test(tag)) && shown(el)) {
        const text = el.innerText.trim();
        if (text) events.push(text);
        item = true;
      }
      if (!busy && ((cl && (cl.contains('slds-icon-typing') || cl.contains('has-progress-indicator'))) || /progress-indicator|typing/.test(tag)) && shown(el)) {
        busy = true;
        busyText = (el.innerText || '').trim().slice(0, 80);
        busyWhy = `${tag}${cls ? '.' + cls.trim().split(/\s+/).slice(0, 3).join('.') : ''}`;
      }
      walk(el, inside || item);
      if (el.shadowRoot) walk(el.shadowRoot, inside || item);
    }
  };
  walk(root || document.body, false);
  return { busy, busyText, busyWhy, messages, events };
}

function scrollChatInPage(arg) {
  const up = n => n.assignedSlot || n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
  const root = window.__afrecRoot && window.__afrecRoot.isConnected ? window.__afrecRoot : document.body;
  const users = [];
  let anyMessage = null;
  const walk = node => {
    for (const el of node.children) {
      const cl = el.classList;
      if (cl && cl.contains('slds-chat-message__text_outbound')) users.push(el);
      if (!anyMessage && cl && (cl.contains('slds-chat-message__text_outbound') || cl.contains('slds-chat-message__text_inbound'))) anyMessage = el;
      walk(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(root);
  const anchor = arg.bottom ? anyMessage : users[arg.userIndex];
  if (!anchor) return false;
  let scroller = null;
  for (let n = up(anchor); n && n !== document.body && n !== document.documentElement; n = up(n)) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) { scroller = n; break; }
  }
  if (!scroller) return false;
  if (arg.bottom) { scroller.scrollTop = scroller.scrollHeight; return true; }
  let row = anchor; // the whole chat row (avatar, name) rather than the text alone
  for (let n = anchor; n && n !== scroller; n = up(n)) {
    if (n.classList && (n.classList.contains('slds-chat-listitem') || n.classList.contains('slds-chat-message'))) row = n;
  }
  scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
  return true;
}

function lightningPanelBoxInPage() {
  const up = n => n.assignedSlot || n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
  const root = window.__afrecRoot && window.__afrecRoot.isConnected ? window.__afrecRoot : null;
  if (!root) return null;
  for (let n = root; n; n = up(n)) {
    const inner = n.shadowRoot && n.shadowRoot.querySelector('.slds-panel');
    const panel = inner && inner.getBoundingClientRect().width > 0 ? inner : n.classList && n.classList.contains('slds-panel') ? n : null;
    if (panel) { const r = panel.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }
  }
  const r = root.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

// ---- surfaces ----

async function clickFirstVisible(candidates) {
  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    for (let i = count - 1; i >= 0; i--) { // the most recent card first
      const item = locator.nth(i);
      if (await item.isVisible().catch(() => false)) { await item.click(); return true; }
    }
  }
  return false;
}

/** `label` is matched as a case-insensitive substring, or as a regex when written /like this/. */
function byLabel(scope, label) {
  const literal = label.match(/^\/(.+)\/([a-z]*)$/);
  const name = literal ? new RegExp(literal[1], literal[2].includes('i') ? literal[2] : literal[2] + 'i')
    : new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  // icon buttons sometimes carry another role (the reply's Like/Dislike/Copy are radios), hence title and aria-label too
  return [...['button', 'link', 'menuitem', 'option', 'radio', 'tab', 'checkbox'].map(role => scope.getByRole(role, { name })),
    scope.getByTitle(name), scope.getByLabel(name), ...(literal ? [] : [scope.getByText(label, { exact: true })]), scope.getByText(name)];
}

/** Presses the most recent visible match in the first scope that has one, waiting up to 15 s for it to render. */
async function clickLabel(scopes, label, timeout = 15000) {
  const end = Date.now() + timeout;
  do {
    for (const scope of scopes) if (await clickFirstVisible(byLabel(scope, label))) return true;
    await sleep(1000);
  } while (Date.now() < end);
  return false;
}

class Lightning {
  constructor(page, conv) {
    this.page = page;
    this.conv = conv;
    this.label = 'Lightning Agentforce panel';
  }

  input() { return this.page.locator('textarea.chat-box').first(); }

  read() { return this.page.mainFrame().evaluate(readChatInPage); }

  scroll(arg) { return this.page.mainFrame().evaluate(scrollChatInPage, arg).catch(() => false); }

  async cropBox() { return this.page.mainFrame().evaluate(lightningPanelBoxInPage); }

  async open(baseUrl) {
    const target = this.conv.path || (this.conv.app ? `/lightning/app/${this.conv.app}` : '/lightning/page/home');
    await this.page.goto(baseUrl + target, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const input = this.input();
    const button = this.page.getByRole('button', { name: 'Agentforce', exact: true }).first();
    const gotIt = this.page.getByRole('button', { name: /^Got It$/i }).first();
    let clicked = false;
    const end = Date.now() + 150000;
    while (Date.now() < end) {
      if (await input.isVisible().catch(() => false)) break;
      if (await gotIt.isVisible().catch(() => false)) { await gotIt.click(); await sleep(2000); continue; } // first-use screens
      if (!clicked && await button.isVisible().catch(() => false)) { await button.click(); clicked = true; await sleep(3000); continue; }
      await sleep(1000);
    }
    if (!(await input.isVisible().catch(() => false))) {
      throw new Error(clicked ? 'the Agentforce panel opened but its chat input never appeared'
        : 'no Agentforce button in the Lightning header: does this user have an agent and the Agentforce permission?');
    }
    await waitStable(this, 20000); // the welcome message
  }

  async reset() {
    const chat = await this.read();
    if (!chat.messages.some(m => m.role === 'user')) return false;
    if (!(await clickFirstVisible([this.page.getByRole('button', { name: /^Clear history$/i })]))) return false;
    await sleep(1500);
    await clickFirstVisible([this.page.getByRole('button', { name: /^(Clear|Clear History|Confirm|Yes|OK|Continue)$/i })]);
    const end = Date.now() + 15000;
    while (Date.now() < end && (await this.read()).messages.some(m => m.role === 'user')) await sleep(1000);
    return true;
  }

  async click(label) {
    // the conversation first, then the panel header; never a page button that happens to share the label
    const scopes = [this.page.locator('div.einstein-assistant-container').first(), this.page.locator('runtime_thp_learning-side-panel-frame').first()];
    if (!(await clickLabel(scopes, label))) throw new Error(`no visible button or link "${label}" in the Agentforce panel after 15 s`);
  }
}

class Messaging {
  constructor(page, conv) {
    this.page = page;
    this.conv = conv;
    this.label = 'Embedded Messaging';
    this.frameLocator = page.frameLocator('#embeddedMessagingFrame');
    this.frame = null;
  }

  async resolveFrame() {
    const handle = await this.page.locator('#embeddedMessagingFrame').elementHandle({ timeout: 60000 });
    this.frame = await handle.contentFrame();
    if (!this.frame) throw new Error('the Embedded Messaging frame has no content');
  }

  input() { return this.frameLocator.locator('textarea').first(); }

  async read() {
    if (!this.frame || this.frame.isDetached()) await this.resolveFrame();
    return this.frame.evaluate(readChatInPage);
  }

  async scroll(arg) {
    if (!this.frame || this.frame.isDetached()) await this.resolveFrame();
    return this.frame.evaluate(scrollChatInPage, arg).catch(() => false);
  }

  async cropBox() { return this.page.locator('#embeddedMessagingFrame').boundingBox(); }

  async open() {
    await this.page.goto(this.conv.site, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const classic = this.page.locator('#embeddedMessagingConversationButton');
    const modern = this.frameLocator.locator('button.chat-fab-container');
    let launcher = null;
    const end = Date.now() + 120000;
    while (!launcher && Date.now() < end) {
      if (await classic.isVisible().catch(() => false)) { launcher = classic; this.variant = 'classic'; }
      else if (await modern.isVisible().catch(() => false)) { launcher = modern; this.variant = 'modern'; }
      else await sleep(1000);
    }
    if (!launcher) throw new Error(`no Embedded Messaging launcher on ${this.conv.site} after 120 s (is the deployment published and its agent active?)`);
    await launcher.click();
    await this.resolveFrame();
    await this.input().waitFor({ state: 'visible', timeout: 90000 });
    await waitStable(this, 8000);
  }

  /** Ends the chat a signed-in user left open: a verified chat persists across visits and keeps its agent version. */
  async reset() {
    const placeholder = (await this.input().getAttribute('placeholder').catch(() => '')) || '';
    if (/start a new/i.test(placeholder)) return false; // classic widget: no conversation is open
    const menu = this.frameLocator.getByRole('button', { name: /chat menu/i }).or(this.frameLocator.locator('button.header-menu-button')).first();
    if (!(await menu.isVisible().catch(() => false))) return false;
    await menu.click();
    await sleep(1000);
    const endItem = this.frameLocator.getByRole('menuitem', { name: /end (chat|conversation)/i }).first();
    if (!(await endItem.isVisible().catch(() => false))) { await this.page.keyboard.press('Escape'); return false; }
    await endItem.click();
    await sleep(2000);
    await clickFirstVisible([this.frameLocator.getByRole('button', { name: /^(end chat|end conversation|end|confirm|yes)$/i })]);
    await sleep(2000);
    await clickFirstVisible([this.frameLocator.getByRole('button', { name: /new conversation|start (a )?new (chat|conversation)/i })]);
    await sleep(2500);
    await this.resolveFrame();
    await this.input().waitFor({ state: 'visible', timeout: 60000 });
    return true;
  }

  async click(label) {
    if (!(await clickLabel([this.frameLocator], label))) throw new Error(`no visible button or link "${label}" in the chat after 15 s`);
  }
}

/** Waits until the chat stops changing (or `timeout` passes). */
async function waitStable(surface, timeout) {
  const end = Date.now() + timeout;
  let last = null;
  let since = Date.now();
  while (Date.now() < end) {
    const chat = await surface.read();
    const sig = JSON.stringify(chat.messages) + chat.busy;
    if (sig !== last) { last = sig; since = Date.now(); } else if (!chat.busy && Date.now() - since > 2500) return;
    await sleep(700);
  }
}

/** Types like a person (or pastes when typeDelay is 0) and sends with Enter; Shift+Enter between lines. */
async function sendText(surface, text, typeDelay) {
  const input = surface.input();
  await input.waitFor({ state: 'visible', timeout: 30000 });
  await input.click();
  if (!typeDelay) {
    await input.fill(text);
  } else {
    const delay = Math.max(8, Math.min(typeDelay, Math.floor(4500 / Math.max(text.length, 1))));
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await input.pressSequentially(lines[i], { delay });
      if (i < lines.length - 1) await input.press('Shift+Enter');
    }
  }
  await input.press('Enter');
}

/**
 * Waits for the agent's answer to what was just sent: new agent messages after `before`, no progress indicator,
 * and no change for `settle` ms. `optional` (a click) returns null when nothing starts within 15 s.
 */
async function awaitReply(surface, before, { timeout, settle, optional = false }) {
  const agentBefore = before.messages.filter(m => m.role === 'agent').length;
  const userBefore = before.messages.filter(m => m.role === 'user').length;
  const eventsBefore = before.events.length;
  const started = Date.now();
  let first = 0;
  let lastChange = Date.now();
  let last = null;
  let echoed = false;
  let handoffSince = 0;
  let vanishedSince = 0;
  let busyWhy = '';
  while (Date.now() - started < timeout) {
    await sleep(700);
    const chat = await surface.read();
    busyWhy = chat.busy ? chat.busyWhy : busyWhy;
    // the answer is what the agent says after the user's new bubble (a late reply to the previous message stays out)
    let seen = 0;
    const echo = chat.messages.findIndex(m => m.role === 'user' && ++seen > userBefore);
    if (echo >= 0) echoed = true;
    const fresh = (echo >= 0 ? chat.messages.slice(echo + 1).filter(m => m.role === 'agent') : chat.messages.filter(m => m.role === 'agent').slice(agentBefore))
      .map(m => m.text).filter(Boolean);
    if (!fresh.length && last) {
      // the answer arrived, then the chat showed its bubble empty (a re-render): keep the text that was seen
      vanishedSince = vanishedSince || Date.now();
      if (Date.now() - vanishedSince >= Math.max(settle, 8000)) return { text: last, parts: [last], first, last: lastChange, vanished: true };
      continue;
    }
    vanishedSince = 0;
    if (!fresh.length) {
      if (!optional && !echoed && Date.now() - started > 20000) throw new Error('the message never appeared in the chat (not sent?)');
      if (optional && !chat.busy && Date.now() - started > 15000) return null;
      const handoff = chat.events.slice(eventsBefore).find(e => /\bleft\b|transferr|ended/i.test(e)) || (/transferr/i.test(chat.busyText) ? chat.busyText : '');
      if (handoff && !handoffSince) handoffSince = Date.now();
      // handed to a person (or the session ended): that is the end of this conversation, recorded as such
      if (handoff && Date.now() - handoffSince > 10000) return { text: `(handed off: ${handoff.replace(/\s+/g, ' ')})`, parts: [], first: handoffSince, last: Date.now(), handoff };
      continue;
    }
    if (!first) first = Date.now();
    const text = fresh.join('\n\n');
    if (text !== last || chat.busy) { last = text; lastChange = Date.now(); continue; }
    if (Date.now() - lastChange >= settle) return { text, parts: fresh, first, last: lastChange };
  }
  if (last) return { text: last, parts: [last], first, last: lastChange, warning: `the agent still looked busy after ${Math.round(timeout / 1000)} s (${busyWhy || 'its answer kept changing'})` };
  throw new Error(`no reply within ${Math.round(timeout / 1000)} s`);
}

const createSurface = (page, conv) => (conv.surface === 'lightning' ? new Lightning(page, conv) : new Messaging(page, conv));

module.exports = { createSurface, sendText, awaitReply, waitStable };
