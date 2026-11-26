const byId = (id) => document.getElementById(id);
const runForm = byId('check');
const runButton = runForm.querySelector('button');
const format = new Intl.NumberFormat('en-US');
const outcomes = {
  warning: 'Warning observed',
  no_warning_observed: 'No warning observed',
  check_failed: 'Check failed',
};
const errors = {
  unauthorized: 'This API key was not accepted.',
  insufficient_credits: 'Your account is out of credits.',
  busy: 'The service is busy. Try again in a few seconds.',
  check_in_progress: 'This check is still running. Retry in a few seconds.',
};
let session;
let gatewayLive = false;
let healthKnown = false;

async function api(path, key, { method = 'GET', body, idem } = {}) {
  const headers = { Authorization: 'Bearer ' + key };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idem) headers['Idempotency-Key'] = idem;
  const response = await fetch(path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000), redirect: 'error',
  });
  const data = path.endsWith('.csv') && response.ok ? await response.text() : await response.json();
  if (!response.ok && !data.status) {
    const error = new Error(errors[data.error] || data.message || 'The API request failed.');
    error.code = data.error;
    throw error;
  }
  return data;
}

function showUsage(usage) {
  byId('credits').textContent = format.format(usage.credits_remaining);
  byId('billed').textContent = format.format(usage.checks_billed);
}

function showDomains(data) {
  byId('domains').value = (data.sources.manual || []).join('\n');
  const imported = Object.entries(data.sources).filter(([source]) => source !== 'manual');
  const labels = imported.map(([source, domains]) => source + ' (' + domains.length + ')');
  byId('domain-summary').textContent = data.domains.length + ' monitored domains.' +
    (labels.length ? ' Synced sources: ' + labels.join(', ') + '.' : '');
}

function showSchedule(data, prefix = '') {
  byId('schedule-enabled').checked = data.enabled;
  byId('interval').value = data.interval_minutes;
  let status = data.enabled ? 'Enabled.' : 'Paused.';
  if (data.next_check_at) status += ' Next due ' + new Date(data.next_check_at).toLocaleString() + '.';
  byId('schedule-status').textContent = prefix + status;
}

function showAlerts(data, prefix = '') {
  const chat = byId('telegram');
  const webhook = byId('discord');
  chat.value = data.telegram_chat || '';
  chat.disabled = !data.telegram_available;
  chat.placeholder = data.telegram_available ? 'Enter a numeric chat ID' : 'Bot setup required';
  webhook.value = '';
  webhook.disabled = !data.discord_available;
  webhook.placeholder = data.discord_configured ? 'Webhook saved' : data.discord_available ? 'Paste a webhook URL' : 'Server setup required';
  byId('save-alerts').disabled = !data.telegram_available && !data.discord_available;
  byId('remove-discord').hidden = !data.discord_configured || !data.discord_available;
  byId('alerts-status').textContent = prefix + (session.demo
    ? 'Telegram and Discord delivery are not active in this preview.'
    : 'Telegram: ' + (data.telegram_chat ? 'configured' : 'off') + '. Discord: ' + (data.discord_configured ? 'configured' : 'off') + '.');
}

function unlock(current, usage) {
  session = current;
  byId('access').hidden = true;
  byId('dashboard').hidden = false;
  byId('monitoring').hidden = true;
  byId('domains-status').textContent = '';
  byId('session-label').textContent = current.demo ? 'Demo account · sample data' : 'Signed in with your API key.';
  byId('sign-out').textContent = current.demo ? 'Close demo' : 'Sign out';
  byId('demo-options').hidden = !current.demo;
  byId('check-status').hidden = true;
  byId('result').hidden = true;
  byId('result').open = false;
  byId('response').textContent = '';
  runForm.reset();
  byId('url').value = current.demo ? 'https://example.com/' : '';
  runButton.disabled = false;
  showUsage(usage);
}

async function loadSettings(current) {
  try {
    const [domains, schedule, alerts] = current.demo
      ? [current.domains, current.schedule, {}]
      : await Promise.all(['domains', 'schedule', 'alerts'].map((path) => api('/v1/' + path, current.key)));
    if (session !== current) return;
    showDomains(domains);
    showSchedule(schedule);
    showAlerts(alerts);
    byId('monitoring').hidden = false;
  } catch (error) {
    if (session !== current) return;
    byId('check-status').hidden = false;
    byId('check-status').textContent = 'Account settings could not be loaded. ' + error.message;
  }
}

function lock(message) {
  const demo = session?.demo;
  session = undefined;
  byId('dashboard').hidden = true;
  byId('access').hidden = false;
  byId('api-key').value = '';
  byId('discord').value = '';
  byId('access-status').textContent = message || (demo ? 'Preview the account with sample data.' : 'Enter your API key to sign in.');
}

byId('sign-in').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const key = byId('api-key').value.trim();
  button.disabled = true;
  byId('access-status').textContent = 'Signing in…';
  try {
    const usage = await api('/v1/usage', key);
    byId('api-key').value = '';
    const current = { key };
    unlock(current, usage);
    await loadSettings(current);
  } catch (error) {
    byId('access-status').textContent = error.code === 'unauthorized' ? error.message : 'Could not sign in. Try again.';
  } finally {
    button.disabled = false;
  }
});

function demoDomains(domains, trackerDomains) {
  const sources = { manual: domains, keitaro: trackerDomains };
  return { sources, domains: [...new Set([...domains, ...trackerDomains])].map((domain) => ({ domain })) };
}

byId('open-demo').addEventListener('click', () => {
  const usage = { credits_remaining: 1000, checks_billed: 0 };
  const current = { demo: true, usage, domains: demoDomains(['example.com'], ['example.org']),
    schedule: { enabled: false, interval_minutes: 15 } };
  unlock(current, usage);
  loadSettings(current);
});

byId('signup-demo').addEventListener('click', () => {
  const status = byId('signup-status');
  if (!healthKnown) {
    status.textContent = 'Checking the gateway status; please try again in a moment.';
  } else if (gatewayLive) {
    status.textContent = 'Verified email signup is not available yet. Use your API key to sign in.';
  } else {
    byId('open-demo').click();
  }
});

byId('sign-out').addEventListener('click', () => lock());

function demoCheck(current, url) {
  const status = byId('scenario').value;
  if (current.usage.credits_remaining === 0) throw new Error(errors.insufficient_credits);
  const charged = status !== 'check_failed';
  if (charged) {
    current.usage.credits_remaining--;
    current.usage.checks_billed++;
  }
  return {
    id: 'demo-check', url, status,
    regions: [{ region: 'single_region_preview', status }],
    billing: { charged, amount_usd: charged ? '0.0003' : '0.0000' },
  };
}

runForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const current = session;
  if (!current) return;
  const input = byId('url');
  const url = new URL(input.value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !url.hostname.includes('.')) {
    input.setCustomValidity('Enter a public HTTP or HTTPS URL on its default port.');
    input.reportValidity();
    return;
  }
  const message = byId('check-status');
  message.hidden = false;
  message.textContent = 'Checking…';
  byId('result').hidden = true;
  runButton.disabled = true;
  try {
    let result;
    if (current.demo) {
      result = demoCheck(current, url.href);
    } else {
      if (current.attempt?.url !== url.href) current.attempt = { url: url.href, id: crypto.randomUUID() };
      result = await api('/v1/check', current.key, { method: 'POST', body: { url: url.href }, idem: current.attempt.id });
      current.attempt = undefined;
    }
    if (session !== current) return;
    message.textContent = outcomes[result.status] + ' · $' + result.billing.amount_usd;
    byId('response').textContent = JSON.stringify(result, null, 2);
    byId('result').hidden = false;
    const usage = current.demo ? current.usage : await api('/v1/usage', current.key).catch(() => null);
    if (session === current && usage) showUsage(usage);
  } catch (error) {
    if (session !== current) return;
    if (error.code === 'unauthorized') return lock('Your API key was rejected. Sign in again.');
    message.textContent = error.message;
  } finally {
    if (session === current) runButton.disabled = false;
  }
});
byId('url').addEventListener('input', (event) => event.target.setCustomValidity(''));

async function saveForm(event, status, save) {
  event.preventDefault();
  const current = session;
  if (!current) return;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await save(current);
  } catch (error) {
    if (session === current) byId(status).textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

byId('domains-form').addEventListener('submit', (event) => saveForm(event, 'domains-status', async (current) => {
  const domains = byId('domains').value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (current.demo) {
    const normalized = domains.map((domain) => domain.toLowerCase());
    if (normalized.length > 500 || normalized.some((domain) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))) {
      throw new Error('Enter up to 500 domain names, one per line.');
    }
    current.domains = demoDomains([...new Set(normalized)].sort(), current.domains.sources.keitaro);
  } else {
    await api('/v1/domains', current.key, { method: 'PUT', body: { source: 'manual', domains } });
    current.domains = await api('/v1/domains', current.key);
  }
  if (session !== current) return;
  showDomains(current.domains);
  byId('domains-status').textContent = 'Manual list saved.';
}));

byId('export').addEventListener('click', async () => {
  const current = session;
  if (!current) return;
  try {
    const csv = current.demo
      ? ['domain', ...current.domains.domains.map(({ domain }) => domain)].join('\n') + '\n'
      : await api('/v1/domains.csv', current.key);
    if (session !== current) return;
    const file = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = file;
    link.download = 'domains.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(file), 1000);
  } catch (error) {
    if (session === current) byId('domains-status').textContent = error.message;
  }
});

byId('schedule-form').addEventListener('submit', (event) => saveForm(event, 'schedule-status', async (current) => {
  const body = { enabled: byId('schedule-enabled').checked, interval_minutes: byId('interval').valueAsNumber };
  current.schedule = current.demo ? body : await api('/v1/schedule', current.key, { method: 'PUT', body });
  if (session === current) showSchedule(current.schedule, 'Saved. ');
}));

byId('alerts-form').addEventListener('submit', (event) => saveForm(event, 'alerts-status', async (current) => {
  if (current.demo) return;
  const body = {};
  const chat = byId('telegram');
  const webhook = byId('discord').value.trim();
  if (!chat.disabled) body.telegram_chat = chat.value.trim() || null;
  if (webhook) body.discord_webhook = webhook;
  const alerts = await api('/v1/alerts', current.key, { method: 'PUT', body });
  if (session === current) showAlerts(alerts, 'Saved. ');
}));

byId('remove-discord').addEventListener('click', async () => {
  const current = session;
  if (!current || current.demo) return;
  try {
    const alerts = await api('/v1/alerts', current.key, { method: 'PUT', body: { discord_webhook: null } });
    if (session === current) showAlerts(alerts, 'Webhook removed. ');
  } catch (error) {
    if (session === current) byId('alerts-status').textContent = error.message;
  }
});

fetch('/healthz', { signal: AbortSignal.timeout(3500) })
  .then((response) => response.ok && response.headers.get('content-type')?.startsWith('application/json') ? response.json() : null)
  .catch(() => null)
  .then((health) => {
    healthKnown = true;
    const live = health?.mode === 'live' && Array.isArray(health.configured_regions) && health.configured_regions.length === 1;
    gatewayLive = live;
    byId('access-status').textContent = live
      ? 'Single-region gateway is live. Enter your API key to sign in.'
      : health?.mode === 'live'
        ? 'This account preview is configured for one region only; the current gateway is not a matching one-region deployment.'
        : 'Preview the account with sample data.';
    byId('sign-in').hidden = !live;
    byId('open-demo').hidden = live;
  });
