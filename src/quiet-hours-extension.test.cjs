const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function loadContentScript(stored = {}) {
  const source = read('extension/src/content/impact-diagnostic.js');
  const keys = source.slice(source.indexOf('  const STORAGE_KEYS = {'), source.indexOf('  let pickerState'));
  const fn = source.slice(source.indexOf('  function dismissQuietHoursDialogs('), source.indexOf('  async function getSnapshot('));
  const timers = []; const logs = []; let publishChecks = 0;
  const context = vm.createContext({
    Date, WeakSet, dialogs: [], logs,
    document: { querySelectorAll: () => context.dialogs },
    sanitizeText: (text) => String(text).replace(/\s+/g, ' ').trim(),
    log: async (...args) => { logs.push(args); },
    runAutoPublishCheck: () => { publishChecks++; },
    window: { setTimeout: (fn) => { timers.push(fn); } },
    chrome: { storage: { local: {
      get: async (names) => Object.fromEntries(names.filter((name) => name in stored).map((name) => [name, stored[name]])),
      set: async (values) => { Object.assign(stored, values); }
    } } },
    lastAutoPublishFingerprint: 'old'
  });
  vm.runInContext(`${keys}\nconst dismissedQuietHoursDialogs = new WeakSet();\nconst recordedQuietHoursDialogs = new WeakSet();\n${fn}\nthis.dismissQuietHoursDialogs = dismissQuietHoursDialogs; this.addQuietHoursContext = addQuietHoursContext;`, context);
  return { context, stored, timers, get publishChecks() { return publishChecks; } };
}

const dialog = (text, buttonText = 'OK') => {
  const button = { innerText: buttonText, clicks: 0, click() { this.clicks++; }, getAttribute: () => null };
  return { innerText: text, button, getClientRects: () => [{}], querySelectorAll: () => (buttonText ? [button] : []) };
};

test('the quiet-hours notice is recorded once and triggers a fresh phone sync', async () => {
  const env = loadContentScript();
  const notice = dialog('Please DO NOT knock on doors for this lead after 8 PM.', '');
  env.context.dialogs = [notice];
  env.context.dismissQuietHoursDialogs();
  env.context.dismissQuietHoursDialogs();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(Date.parse(env.stored['impact.quietHoursNoticeAt']) > Date.now() - 5000, 'recorded even without a close button');
  assert.equal(env.context.lastAutoPublishFingerprint, '');
  assert.equal(env.timers.length, 1, 'recorded once per dialog');
  env.timers[0]();
  assert.equal(env.publishChecks, 1);
});

test('the notice is still dismissed, and other dialogs are ignored', async () => {
  const env = loadContentScript();
  const notice = dialog('Do not visit after 8:00 p.m.');
  const other = dialog('Appointment saved');
  env.context.dialogs = [other, notice];
  env.context.dismissQuietHoursDialogs();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notice.button.clicks, 1);
  assert.equal(other.button.clicks, 0);
  assert.ok(env.stored['impact.quietHoursNoticeAt']);
});

test('published leads carry the IMPACT time zone and the last notice time', async () => {
  const env = loadContentScript();
  const lead = await env.context.addQuietHoursContext({ available: true, leadName: 'A' });
  assert.equal(lead.impactTimeZone, 'America/New_York');
  assert.equal(lead.quietHoursNoticeAt, undefined);
  const configured = loadContentScript({ 'impact.timeZone': 'America/Chicago', 'impact.quietHoursNoticeAt': '2026-09-25T00:02:00.000Z' });
  const lead2 = await configured.context.addQuietHoursContext({ available: true });
  assert.equal(lead2.impactTimeZone, 'America/Chicago');
  assert.equal(lead2.quietHoursNoticeAt, '2026-09-25T00:02:00.000Z');
});

test('the extension fingerprints include the quiet-hours fields so changes are re-sent', () => {
  const content = read('extension/src/content/impact-diagnostic.js');
  const worker = read('extension/src/background/service-worker.js');
  for (const source of [content, worker]) {
    assert.match(source, /impactTimeZone: lead\??\.impactTimeZone/);
    assert.match(source, /quietHoursNoticeAt: lead\??\.quietHoursNoticeAt/);
  }
});

test('options offer common IMPACT time zones with Eastern as the default', async () => {
  const keys = read('extension/src/shared/storage-keys.js').replace(/^export /gm, '');
  const context = vm.createContext({});
  vm.runInContext(`${keys}\nthis.STORAGE_KEYS = STORAGE_KEYS; this.DEFAULT_IMPACT_TIME_ZONE = DEFAULT_IMPACT_TIME_ZONE; this.IMPACT_TIME_ZONES = IMPACT_TIME_ZONES;`, context);
  assert.equal(context.DEFAULT_IMPACT_TIME_ZONE, 'America/New_York');
  assert.equal(context.STORAGE_KEYS.impactTimeZone, 'impact.timeZone');
  const zones = context.IMPACT_TIME_ZONES.map(([zone]) => zone);
  for (const zone of ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles']) assert.ok(zones.includes(zone));
  for (const zone of zones) assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: zone }));
  assert.match(read('extension/src/options/options.html'), /id="impactTimeZone"/);
  assert.match(read('extension/src/options/options.js'), /\[STORAGE_KEYS\.impactTimeZone\]: impactTimeZoneInput\.value/);
});
