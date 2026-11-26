(() => {
  'use strict';
  const CONSENT_KEY = 'gsb-vm-consent';
  const SCRIPT_URL = 'https://vibemetrics.click/tracker.js';
  const SITE_ID = 'gsb-api-lol';
  const SITE_KEY = '4x2o7P07lM3F9VxJ54LOstnJhL8wkKD6pwS2kFKtc3I';
  const banner = document.querySelector('[data-vm-consent]');
  if (!banner) return;

  const doNotTrack = () => navigator.doNotTrack === '1' || window.doNotTrack === '1';
  function loadTracker() {
    if (doNotTrack() || document.querySelector(`script[src="${SCRIPT_URL}"]`)) return;
    const script = document.createElement('script');
    script.defer = true;
    script.src = SCRIPT_URL;
    script.setAttribute('data-site-id', SITE_ID);
    script.setAttribute('data-site-key', SITE_KEY);
    document.head.append(script);
  }
  function showPreferences() {
    banner.hidden = false;
    const accept = banner.querySelector('[data-vm-accept]');
    if (accept) accept.focus();
  }
  function getConsent() {
    try { return localStorage.getItem(CONSENT_KEY); }
    catch { return null; }
  }
  function choose(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch { /* Keep this choice for the current page. */ }
    banner.hidden = true;
    if (value === 'accepted') loadTracker();
  }

  const saved = getConsent();
  if (saved === 'accepted') loadTracker();
  else if (saved !== 'declined') banner.hidden = false;

  banner.querySelector('[data-vm-accept]')?.addEventListener('click', () => choose('accepted'));
  banner.querySelector('[data-vm-decline]')?.addEventListener('click', () => choose('declined'));
  document.querySelectorAll('[data-vm-preferences]').forEach(button => button.addEventListener('click', showPreferences));
})();
