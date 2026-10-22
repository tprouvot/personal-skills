'use strict';
/**
 * Thin wrappers around the sf CLI: org details, single-use frontdoor URLs, SOQL and sfdx auth URL logins.
 * Frontdoor URLs carry a session: callers never print them.
 */
const { execFile } = require('child_process');

function sf(args, { timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, SF_DISABLE_TELEMETRY: 'true', SF_AUTOUPDATE_DISABLE: 'true', SF_SKIP_NEW_VERSION_CHECK: 'true' };
    execFile('sf', [...args, '--json'], { encoding: 'utf8', timeout, maxBuffer: 50 * 1024 * 1024, env }, (err, stdout) => {
      const text = stdout || '';
      const start = text.indexOf('{');
      let json = null;
      if (start >= 0) {
        try { json = JSON.parse(text.slice(start)); } catch (e) { json = null; }
      }
      if (json && json.status === 0) return resolve(json.result);
      const reason = (json && (json.message || json.name)) || (err && err.code === 'ENOENT' ? 'the sf CLI is not installed' : err && err.message) || 'failed';
      reject(new Error(`sf ${args.slice(0, 2).join(' ')} failed: ${String(reason).split('\n')[0]}`));
    });
  });
}

const orgs = new Map();

/** { alias, id, instanceUrl, username } of an authorized org, cached per run. */
function orgInfo(alias) {
  if (!orgs.has(alias)) {
    orgs.set(alias, sf(['org', 'display', '--target-org', alias]).then(r => ({
      alias, id: r.id, instanceUrl: String(r.instanceUrl).replace(/\/$/, ''), username: r.username,
    })));
  }
  return orgs.get(alias);
}

/** A single-use URL that signs the browser in as the alias's user. */
async function frontdoorUrl(alias, targetPath) {
  const args = ['org', 'open', '--url-only', '--target-org', alias];
  if (targetPath) args.push('--path', targetPath);
  return (await sf(args)).url;
}

async function query(alias, soql) {
  return (await sf(['data', 'query', '--target-org', alias, '--query', soql])).records || [];
}

/** Authorizes the org of an sfdx auth URL file under an alias (the same username simply refreshes its auth). */
async function loginSfdxUrl(file, alias) {
  await sf(['org', 'login', 'sfdx-url', '--sfdx-url-file', file, '--alias', alias], { timeout: 300000 });
}

const soqlString = v => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The active user matching a full username, the part before the @, or a full name. */
async function findUser(alias, key) {
  const where = key.includes('@') ? `Username = ${soqlString(key)}`
    : /\s/.test(key) ? `Name = ${soqlString(key)}`
      : `Username LIKE ${soqlString(key.replace(/[%_]/g, '\\$&') + '@%')}`;
  const rows = await query(alias, `SELECT Id, Username, Name, ContactId FROM User WHERE IsActive = true AND ${where}`);
  if (!rows.length) throw new Error(`no active user "${key}" in ${alias}`);
  if (rows.length > 1) throw new Error(`"${key}" matches ${rows.length} users in ${alias} (${rows.map(r => r.Username).join(', ')}): give the full username`);
  return rows[0];
}

/** The Experience Cloud site (Network) a community user belongs to; `wanted` is a site name or Id. */
async function findNetwork(alias, user, wanted) {
  const rows = await query(alias, `SELECT NetworkId, Network.Name, Network.Status FROM NetworkMember WHERE MemberId = ${soqlString(user.Id)}`);
  if (!rows.length) throw new Error(`${user.Username} is not a member of any Experience Cloud site`);
  const picked = wanted
    ? rows.filter(r => r.NetworkId.slice(0, 15) === String(wanted).slice(0, 15) || r.Network.Name.toLowerCase() === String(wanted).toLowerCase())
    : rows;
  if (picked.length === 1) return { id: picked[0].NetworkId, name: picked[0].Network.Name };
  const names = rows.map(r => r.Network.Name).join(', ');
  throw new Error(wanted ? `${user.Username} is not a member of a site named "${wanted}" (member of: ${names})`
    : `${user.Username} belongs to several sites (${names}): set network: to one of them`);
}

module.exports = { orgInfo, frontdoorUrl, query, loginSfdxUrl, findUser, findNetwork };
