'use strict';
/**
 * Plays one conversation: signs in off camera, opens the chat in a fresh recording context, plays every step, then
 * writes the screenshots, the videos, the timeline and the transcript to the conversation's folder.
 */
const fs = require('fs');
const path = require('path');
const { signIn } = require('./auth');
const { createSurface, sendText, awaitReply, waitStable } = require('./surfaces');
const media = require('./media');
const { writeTranscript } = require('./report');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
const oneLine = text => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > 70 ? t.slice(0, 67) + '...' : t; };
const slug = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ')
  .trim().split(' ').slice(0, 6).join('-').slice(0, 40) || 'step';
/** Waits for `file` to hold something; returns it trimmed and deletes the file (a one-time code, typically), or null. */
async function waitForFile(file, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
    if (text) { fs.rmSync(file, { force: true }); return text; }
    await sleep(1000);
  }
  return null;
}
const readingPause = text => Math.max(2000, Math.min(5000, String(text).length * 25));
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function contextOptions(conv, extra = {}) {
  const v = conv.viewport;
  const options = { viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.scale, ...extra };
  if (v.mobile) Object.assign(options, { isMobile: true, hasTouch: true, userAgent: MOBILE_UA });
  return options;
}

// Runs in every page of a Login-As recording when hideLoginAsBanner is on.
function hideLoginAsBanner() {
  const hide = () => {
    for (const el of document.querySelectorAll('#oneHeader .system-message')) {
      if (/logged in as|log out as/i.test(el.textContent || '')) el.style.setProperty('display', 'none', 'important');
    }
  };
  new MutationObserver(hide).observe(document.documentElement || document, { childList: true, subtree: true });
}

function clip(box, viewport) {
  if (!box) return null;
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const width = Math.min(box.width, viewport.width - x);
  const height = Math.min(box.height, viewport.height - y);
  return width > 20 && height > 20 ? { x, y, width, height } : null;
}

async function runConversation(browser, conv, run) {
  const dir = path.join(run.out, conv.folder);
  fs.mkdirSync(dir, { recursive: true });
  const log = msg => console.log(`[${conv.name}] ${msg}`);
  const result = {
    name: conv.name, folder: conv.folder, file: conv.file, surface: conv.surface, signIn: conv.signIn, who: null,
    status: 'recorded', exchanges: [], flags: [], warnings: [], outputs: [], error: null, startedAt: new Date().toISOString(),
  };
  const started = Date.now();
  const recordVideo = conv.record.video || conv.record.gif;
  const events = [];
  let videoStart = Date.now();
  const mark = (kind, step = null, at = Date.now()) => events.push({ kind, step, t: at - videoStart });
  let context = null;
  let page = null;
  let video = null;
  let crop = null;

  try {
    log(`signing in (${conv.signIn})`);
    const auth = await signIn(browser, conv, contextOptions(conv), path.join(dir, 'error.png'));
    result.who = auth.who;
    context = await browser.newContext(contextOptions(conv, {
      storageState: auth.storageState,
      ...(recordVideo ? { recordVideo: { dir: path.join(dir, '.raw'), size: { width: conv.viewport.width, height: conv.viewport.height } } } : {}),
    }));
    if (conv.hideLoginAsBanner) await context.addInitScript(hideLoginAsBanner);
    videoStart = Date.now();
    page = await context.newPage();
    video = page.video();
    const surface = createSurface(page, conv);
    log(`opening the ${surface.label} as ${auth.who}`);
    await surface.open(auth.baseUrl);
    if (conv.fresh && conv.signIn !== 'guest' && await surface.reset()) log('ended the chat a previous visit left open');
    // On Messaging the first message opens the conversation: the welcome comes first, sometimes an answer after it.
    let firstSettle = conv.surface === 'messaging' ? Math.max(conv.settle, 12000) : conv.settle;
    if (conv.needsWarmup) {
      log(`warm-up "${conv.warmup}" (the first message only opens the conversation)`);
      const before = await surface.read();
      await sendText(surface, conv.warmup, 0);
      const reply = await awaitReply(surface, before, { timeout: conv.replyTimeout, settle: firstSettle });
      firstSettle = conv.settle;
      result.warmup = { text: conv.warmup, reply: reply.text };
    }
    await surface.scroll({ bottom: true });
    mark('ready');
    if (conv.record.screenshots) await page.screenshot({ path: path.join(dir, '00-open.png') });

    let n = 0;
    let handedOff = false; // the conversation stopped early: a hand-off, or no input for type-from
    let stoppedForInput = false;
    let skipped = 0;
    for (let i = 0; i < conv.steps.length; i++) {
      const step = conv.steps[i];
      if (handedOff && (step.type !== 'expect' || skipped)) { skipped++; continue; } // after a hand-off only its own expects run
      if (step.type === 'expect') {
        const target = result.exchanges[result.exchanges.length - 1];
        const ok = !!(target && target.reply && new RegExp(step.pattern, step.flags).test(target.reply));
        target.checks.push({ pattern: step.display, ok });
        if (!ok) { result.flags.push(`${target.n}: the reply does not match ${step.display}`); log(`   expect ${step.display}: no match (flagged)`); }
        continue;
      }
      if (step.type === 'wait') {
        mark('start', i);
        await sleep(step.seconds * 1000);
        mark('waitEnd', i);
        continue;
      }
      let text = step.text;
      if (step.fromFile) {
        log(`${n + 1}. waiting for ${step.fromFile} (up to ${Math.round(conv.inputTimeout / 60000)} min)`);
        text = await waitForFile(step.fromFile, conv.inputTimeout);
        if (text === null) { // nothing came: the recording ends at the prompt, which is still worth keeping
          result.flags.push(`${n + 1}: nothing was written to ${step.fromFile} within ${Math.round(conv.inputTimeout / 60000)} min, so the recording ends before this step`);
          log('   no input arrived: the recording ends here (flagged)');
          handedOff = true;
          stoppedForInput = true;
          skipped++;
          continue;
        }
      }
      n++;
      await waitStable(surface, 30000); // nothing still arriving from the previous turn
      const before = await surface.read();
      const userIndex = before.messages.filter(m => m.role === 'user').length;
      mark('start', i);
      if (step.type === 'message') {
        log(`${n}. ${step.fromFile ? `typing ${text.length} characters from ${path.basename(step.fromFile)}` : oneLine(text)}`);
        await sendText(surface, text, recordVideo ? conv.typeDelay : 0);
      } else {
        log(`${n}. click "${step.label}"`);
        await surface.click(step.label);
      }
      const sentAt = Date.now();
      mark('sent', i, sentAt);
      const reply = await awaitReply(surface, before, { timeout: conv.replyTimeout, settle: firstSettle, optional: step.type === 'click' });
      firstSettle = conv.settle;
      const shown = step.fromFile ? `${'•'.repeat(text.length)} (typed from ${path.basename(step.fromFile)})` : step.text;
      const exchange = { n, type: step.type, text: shown, label: step.label, reply: reply ? reply.text : null, seconds: null, screenshot: null, checks: [] };
      if (reply) {
        mark('first', i, reply.first);
        mark('last', i, reply.last);
        exchange.seconds = Math.max(0, Math.round((reply.first - sentAt) / 1000));
        if (reply.warning) result.warnings.push(`${n}: ${reply.warning}`);
        if (reply.vanished) result.flags.push(`${n}: the answer appeared, then the chat showed its bubble empty, so the screenshot and the end of the video miss it`);
        if (/something went wrong/i.test(reply.text)) result.flags.push(`${n}: the agent answered with an error ("${oneLine(reply.text)}")`);
        if (reply.handoff) { handedOff = true; exchange.handoff = true; }
        log(reply.handoff ? `   handed off: ${reply.handoff.replace(/\s+/g, ' ')}`
          : `   answered in ${exchange.seconds} s${reply.vanished ? ', then the bubble went empty (flagged)' : ''}${/something went wrong/i.test(reply.text) ? ' with an error (flagged)' : ''}`);
      } else {
        log('   no reply (fine for a click)');
      }
      if (step.type === 'message' && reply) await surface.scroll({ userIndex });
      mark('scroll', i);
      await sleep(300);
      if (conv.record.screenshots) {
        exchange.screenshot = `${pad(n)}-${slug(step.fromFile ? 'code' : step.text || step.label)}.png`;
        const box = clip(await surface.cropBox().catch(() => null), conv.viewport);
        await page.screenshot({ path: path.join(dir, exchange.screenshot), ...(box ? { clip: box } : {}) });
      }
      if (recordVideo && reply) await sleep(readingPause(reply.text));
      mark('read', i);
      await surface.scroll({ bottom: true });
      result.exchanges.push(exchange);
    }
    if (skipped && !stoppedForInput) result.flags.push(`${n}: the agent handed the conversation off, so the ${skipped} step(s) after it were not played`);
    await sleep(500);
    mark('end');
    crop = await surface.cropBox().catch(() => null);
    if (conv.record.screenshots) await page.screenshot({ path: path.join(dir, '99-end.png') });
  } catch (e) {
    result.status = 'failed';
    result.error = e.message.split('\n')[0];
    log(`FAILED: ${result.error}`);
    if (page) await page.screenshot({ path: path.join(dir, 'error.png') }).catch(() => {});
  } finally {
    if (page) await page.close().catch(() => {});
    if (video) {
      try {
        await video.saveAs(path.join(dir, 'conversation.webm'));
        await video.delete();
      } catch (e) {
        result.warnings.push('video: ' + e.message.split('\n')[0]);
      }
    }
    if (context) await context.close().catch(() => {});
    fs.rmSync(path.join(dir, '.raw'), { recursive: true, force: true });
  }

  const webm = path.join(dir, 'conversation.webm');
  if (fs.existsSync(webm) && result.status !== 'failed') {
    const end = events.find(e => e.kind === 'end');
    const segments = media.keepSegments(events, end ? end.t : Date.now() - videoStart);
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify({ events, segments }, null, 1));
    try {
      const mp4 = path.join(dir, 'conversation.mp4');
      await media.makeMp4(webm, mp4, segments);
      if (conv.record.gif) {
        await media.makeGif(mp4, path.join(dir, 'conversation.gif'), crop, conv.viewport);
        result.outputs.push('conversation.gif');
      }
      if (conv.record.video) result.outputs.push('conversation.mp4', 'conversation.webm');
      else { fs.rmSync(mp4, { force: true }); fs.rmSync(webm, { force: true }); }
    } catch (e) {
      result.warnings.push(e.message.split('\n')[0]);
      result.outputs.push('conversation.webm');
    }
  } else if (fs.existsSync(webm)) {
    result.outputs.push('conversation.webm');
  }
  if (result.status !== 'failed' && result.flags.length) result.status = 'flagged';
  result.durationMs = Date.now() - started;
  writeTranscript(conv, result, dir);
  result.outputs.unshift('transcript.md');
  log(`${result.status} in ${Math.round(result.durationMs / 1000)} s -> ${dir}`);
  return result;
}

module.exports = { runConversation };
