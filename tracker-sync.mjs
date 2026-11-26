#!/usr/bin/env node
// Node.js 22+. Supply credentials through environment variables.
import { rename, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

const env = process.env;
const [mode, flag] = process.argv.slice(2);
const dry = flag === '--dry-run';

function valueAt(row, field) {
  return field.split('.').reduce((value, key) => value?.[key], row);
}

function domainName(value) {
  if (typeof value !== 'string' || !value.trim()) return;
  const input = value.trim();
  if (!/^https?:\/\//i.test(input) && /[\s/:?#@\\]/.test(input)) return;
  const url = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
  if (url.username || url.password || url.port || isIP(url.hostname)) return;
  const host = url.hostname.replace(/\.$/, '');
  return host.includes('.') ? host : undefined;
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('HTTP ' + response.status + ' from ' + new URL(url).hostname);
  }
  return response;
}

async function saveCsv(path, content) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main() {
  if (!['binom', 'keitaro', 'export'].includes(mode) || (flag && !dry) || (mode === 'export' && dry)) {
    throw new Error('Usage: node tracker-sync.mjs binom|keitaro [--dry-run] or node tracker-sync.mjs export');
  }
  let service;
  let auth;
  if (!dry) {
    if (!env.GSB_API_KEY) throw new Error('Set GSB_API_KEY.');
    service = new URL(env.GSB_API_URL || 'https://gsb-api.lol');
    if (service.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(service.hostname)) {
      throw new Error('Use HTTPS for GSB_API_URL.');
    }
    auth = { Authorization: 'Bearer ' + env.GSB_API_KEY };
  }
  if (mode === 'export') {
    const response = await request(new URL('/v1/domains.csv', service), { headers: auth });
    const csv = await response.text();
    if (env.GSB_EXPORT_FILE) await saveCsv(env.GSB_EXPORT_FILE, csv);
    else process.stdout.write(csv);
    return;
  }

  if (!env.TRACKER_API_KEY) throw new Error('Set TRACKER_API_KEY.');
  if (mode === 'binom' && !env.TRACKER_DOMAINS_URL) throw new Error('Set TRACKER_DOMAINS_URL using the tracker’s /api/doc.');
  if (!env.TRACKER_DOMAINS_URL && !env.TRACKER_URL) throw new Error('Set TRACKER_URL or TRACKER_DOMAINS_URL.');
  const endpoint = new URL(env.TRACKER_DOMAINS_URL || '/admin_api/v1/domains', env.TRACKER_URL || undefined);
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('Enter the tracker HTTP(S) endpoint without URL credentials.');
  }
  const header = env.TRACKER_KEY_HEADER || (mode === 'binom' ? 'api-key' : 'X-Api-Key');
  const response = await request(endpoint, { headers: { [header]: (env.TRACKER_KEY_PREFIX || '') + env.TRACKER_API_KEY } });
  const data = await response.json();
  const rows = env.TRACKER_ROWS ? valueAt(data, env.TRACKER_ROWS) : data;
  if (!Array.isArray(rows)) throw new Error('Expected an array. Set TRACKER_ROWS for a nested response.');
  const include = env.TRACKER_INCLUDE ? new RegExp(env.TRACKER_INCLUDE, 'i') : null;
  const exclude = env.TRACKER_EXCLUDE ? new RegExp(env.TRACKER_EXCLUDE, 'i') : null;
  const domains = new Set();
  for (const row of rows) {
    if (env.TRACKER_INCLUDE_INACTIVE !== '1' && ['deleted', 'disabled', 'archived', 'inactive'].includes(row?.state)) continue;
    if (env.TRACKER_GROUP && String(row?.group_id) !== env.TRACKER_GROUP && row?.group !== env.TRACKER_GROUP) continue;
    const value = typeof row === 'string' ? row : env.TRACKER_FIELD ? valueAt(row, env.TRACKER_FIELD) : row?.name || row?.domain || row?.host;
    const host = domainName(value);
    if (host && (!include || include.test(host)) && !exclude?.test(host)) domains.add(host);
  }
  const list = [...domains].sort();
  if (!list.length && env.GSB_ALLOW_EMPTY !== '1') throw new Error('No domains matched. Set GSB_ALLOW_EMPTY=1 to replace a source with an empty list.');
  if (list.length > 500) throw new Error('Filter the tracker list to 500 domains or fewer.');
  if (dry) {
    console.log(list.join('\n'));
    return;
  }
  const source = env.GSB_SOURCE || mode;
  await (await request(new URL('/v1/domains', service), {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, domains: list }),
  })).json();
  if (env.GSB_EXPORT_FILE) await saveCsv(env.GSB_EXPORT_FILE, ['domain', ...list].join('\n') + '\n');
  console.log('Synced ' + list.length + ' domains from ' + source + '.');
}

main().catch((error) => {
  // Avoid reporting credential-bearing URLs from a failed request.
  console.error(error.cause ? 'Tracker sync request failed.' : error.message);
  process.exitCode = 1;
});
