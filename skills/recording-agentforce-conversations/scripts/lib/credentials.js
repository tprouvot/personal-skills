'use strict';
/**
 * Reads a credentials file: one `username password  (optional note)` per line, `#` for comments.
 * A user is picked by full username or by the part before the @. Passwords are never logged.
 */
const fs = require('fs');

function findCredentials(file, user) {
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split(/\s+/))
    .filter(cells => cells.length >= 2);
  const key = String(user).toLowerCase();
  const matches = rows.filter(([username]) => {
    const u = username.toLowerCase();
    return u === key || u.split('@')[0] === key;
  });
  if (!matches.length) throw new Error(`no line for "${user}" in ${file}`);
  if (matches.length > 1) throw new Error(`"${user}" matches ${matches.length} lines in ${file}: use the full username`);
  return { username: matches[0][0], password: matches[0][1] };
}

module.exports = { findCredentials };
