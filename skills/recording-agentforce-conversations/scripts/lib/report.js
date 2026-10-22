'use strict';
/** Writes each conversation's transcript.md, and the run's report.md and report.json. */
const fs = require('fs');
const path = require('path');

const SURFACES = { lightning: 'Lightning Agentforce panel', messaging: 'Embedded Messaging' };
const STATUS = { recorded: 'recorded', flagged: 'recorded, flagged', failed: 'FAILED' };
const quote = text => String(text || '').split('\n').map(l => (l.trim() ? '> ' + l : '>')).join('\n');
const stamp = iso => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const minutes = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };

function writeTranscript(conv, result, dir) {
  const lines = [
    `# ${conv.name}`, '',
    `- Surface: ${SURFACES[conv.surface]}${conv.surface === 'messaging' ? ` on ${conv.site}` : ''}`,
    `- Signed in: ${result.who || '(not signed in)'}`,
    `- Recorded: ${stamp(result.startedAt)}`,
    `- Script: ${path.relative(process.cwd(), conv.file) || conv.file}`, '',
  ];
  if (result.warmup) lines.push(`_Warm-up: "${result.warmup.text}" was sent first, because the first message only opens the conversation. The agent answered:_`, '', quote(result.warmup.reply), '');
  for (const ex of result.exchanges) {
    if (ex.type === 'click') lines.push(`## ${ex.n}. Clicked "${ex.label}"`, '');
    else lines.push(`## ${ex.n}. You`, '', ex.text, '');
    lines.push(`**Agent**${ex.seconds != null ? ` (answered in ${ex.seconds} s)` : ''}:`, '', ex.reply ? quote(ex.reply) : '_no reply_', '');
    for (const check of ex.checks) lines.push(check.ok ? `- expect \`${check.pattern}\`: matches` : `- **expect \`${check.pattern}\`: no match (flagged)**`);
    if (ex.checks.length) lines.push('');
    if (ex.screenshot) lines.push(`![Reply ${ex.n}](${ex.screenshot})`, '');
  }
  if (result.warnings.length) lines.push('## Warnings', '', ...result.warnings.map(w => `- ${w}`), '');
  if (result.error) lines.push('## Failed', '', result.error, '', '![Last screen](error.png)', '');
  fs.writeFileSync(path.join(dir, 'transcript.md'), lines.join('\n'));
}

function writeRunReport(results, run) {
  const link = (r, file) => `[${file.replace(/^conversation\./, '').replace('transcript.md', 'transcript')}](${encodeURI(r.folder + '/' + file)})`;
  const lines = [
    `# Agentforce recordings, ${stamp(run.startedAt)}`, '',
    `${results.length} conversation(s), ${results.filter(r => r.status !== 'failed').length} recorded, `
      + `${results.filter(r => r.status === 'flagged').length} flagged, ${results.filter(r => r.status === 'failed').length} failed, in ${minutes(run.durationMs)}.`, '',
    '| Conversation | Surface | Signed in | Result | Exchanges | Time | Files |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(r => `| ${r.name} | ${SURFACES[r.surface]} | ${r.who || '-'} | ${STATUS[r.status]} | ${r.exchanges.length} | ${minutes(r.durationMs)} | `
      + `${r.outputs.filter(f => !f.endsWith('.webm')).map(f => link(r, f)).join(' · ')} |`),
    '',
  ];
  const flagged = results.filter(r => r.flags.length);
  if (flagged.length) lines.push('## Flags', '', ...flagged.flatMap(r => r.flags.map(f => `- ${r.name}, exchange ${f}`)), '');
  const warned = results.filter(r => r.warnings.length);
  if (warned.length) lines.push('## Warnings', '', ...warned.flatMap(r => r.warnings.map(w => `- ${r.name}: ${w}`)), '');
  const failed = results.filter(r => r.status === 'failed');
  if (failed.length) lines.push('## Failures', '', ...failed.map(r => `- ${r.name}: ${r.error} (last screen: ${r.folder}/error.png)`), '');
  fs.writeFileSync(path.join(run.out, 'report.md'), lines.join('\n'));
  fs.writeFileSync(path.join(run.out, 'report.json'), JSON.stringify({ ...run, results }, null, 1));
}

module.exports = { writeTranscript, writeRunReport };
