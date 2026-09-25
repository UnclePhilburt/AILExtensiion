const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '../phone-web/public', file), 'utf8');
const store = vm.createContext({ JSON, Object });
vm.runInContext(`${read('settings-store.js').replace(/^export /gm, '')}\nObject.assign(this, { SETTINGS_KEY, TEXT_SIZES, DEFAULT_SETTINGS, normalizeSettings, loadPhoneSettings, savePhoneSettings, resetPhoneSettings, displayAttributes });`, store);
const plain = (value) => JSON.parse(JSON.stringify(value));

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}
const DEFAULTS = { keepAwake: true, vibrate: true, confirmResults: true, textSize: 'normal', showHeadsUp: true, showDoNotKnock: true, showEncouragement: true, encourageAfterResults: true };

test('defaults: everything on, Normal text, one JSON key', () => {
  assert.equal(store.SETTINGS_KEY, 'impact.phoneSettings');
  assert.deepEqual(plain(store.DEFAULT_SETTINGS), DEFAULTS);
  assert.deepEqual(plain(store.loadPhoneSettings(memoryStorage())), DEFAULTS);
  assert.deepEqual(plain(store.TEXT_SIZES.map((s) => s.id)), ['normal', 'large', 'xlarge']);
});

test('invalid or partial saved data falls back per setting', () => {
  const load = (raw) => plain(store.loadPhoneSettings(memoryStorage({ 'impact.phoneSettings': raw })));
  assert.deepEqual(load('not json'), DEFAULTS);
  assert.deepEqual(load('[1,2]'), DEFAULTS);
  assert.deepEqual(load(JSON.stringify({ vibrate: 'no', textSize: 'huge', extra: 1 })), DEFAULTS);
  assert.deepEqual(load(JSON.stringify({ vibrate: false, textSize: 'xlarge' })), { ...DEFAULTS, vibrate: false, textSize: 'xlarge' });
  assert.deepEqual(plain(store.loadPhoneSettings({ getItem() { throw new Error('blocked'); } })), DEFAULTS);
});

test('saving merges one change at a time; reset clears the key', () => {
  const storage = memoryStorage();
  store.savePhoneSettings(storage, { keepAwake: false });
  const after = store.savePhoneSettings(storage, { textSize: 'large' });
  assert.deepEqual(plain(after), { ...DEFAULTS, keepAwake: false, textSize: 'large' });
  assert.deepEqual(JSON.parse(storage.data['impact.phoneSettings']), plain(after));
  assert.deepEqual(plain(store.savePhoneSettings(storage, { textSize: 'bogus' })).textSize, 'large', 'invalid change ignored');
  assert.deepEqual(plain(store.resetPhoneSettings(storage)), DEFAULTS);
  assert.equal('impact.phoneSettings' in storage.data, false);
  assert.doesNotThrow(() => store.savePhoneSettings({ getItem: () => null, setItem() { throw new Error('full'); } }, { vibrate: false }));
});

test('the boot script sets the same <html> attributes as settings-store.js, before paint and on pageshow', () => {
  const boot = read('settings-boot.js');
  const cases = [
    {}, { textSize: 'large' }, { textSize: 'xlarge', showHeadsUp: false }, { showDoNotKnock: false },
    { textSize: 'huge', showHeadsUp: 'no', showDoNotKnock: 0 }, { showHeadsUp: false, showDoNotKnock: false, textSize: 'normal' }
  ];
  for (const saved of cases) {
    const attrs = {}; const listeners = {};
    const root = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
    const storage = memoryStorage({ 'impact.phoneSettings': JSON.stringify(saved) });
    vm.runInNewContext(boot, { localStorage: storage, document: { documentElement: root }, window: { addEventListener: (name, fn) => { listeners[name] = fn; } } });
    const expected = {};
    for (const [name, value] of Object.entries(store.displayAttributes(store.loadPhoneSettings(storage)))) if (value !== null) expected[name] = value;
    assert.deepEqual(attrs, expected, JSON.stringify(saved));
    // A change made on the Settings page shows when the page is restored from the back/forward cache.
    storage.setItem('impact.phoneSettings', JSON.stringify({ textSize: 'xlarge' }));
    listeners.pageshow();
    assert.equal(attrs['data-text-size'], 'xlarge');
    assert.equal(typeof listeners.storage, 'function');
  }
});

test('the CSS implements every display setting', () => {
  const css = read('styles.css');
  assert.match(css, /html\[data-hide-heads-up\] \.headsUp, html\[data-hide-dnk\] \.quietHoursFlag \{ display:none; \}/);
  assert.match(css, /html\[data-text-size="large"\] :is\(\.workspace,\.calendarPage,\.home\) \{ --text-zoom:1\.15; \}html\[data-text-size="xlarge"\] :is\(\.workspace,\.calendarPage,\.home\) \{ --text-zoom:1\.3; \}/);
  assert.match(css, /\.calendarPage :is\(\.calCard,\.calNotice\) \{ zoom:var\(--text-zoom, 1\); \}/);
  assert.match(read('workspace.html'), /<main class="app workspace" hidden>/);
});

test('the settings page has a control for every setting, and the back link only goes to known pages', () => {
  const html = read('settings.html');
  for (const id of ['bgGrid', 'keepAwake', 'vibrate', 'confirmResults', 'textSize', 'showHeadsUp', 'showDoNotKnock', 'showEncouragement', 'encourageAfterResults', 'resetSettings', 'savedHint', 'settingsBack']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(html, /Bad Number/, 'Bad Number is not wired to IMPACT, so it is not offered');
  const js = read('settings.js');
  assert.match(js, /const SWITCHES = \['keepAwake', 'vibrate', 'confirmResults', 'showHeadsUp', 'showDoNotKnock', 'showEncouragement', 'encourageAfterResults'\];/);
  assert.match(js, /BACK\[new URLSearchParams\(location\.search\)\.get\('from'\)\] \|\| BACK\.workspace/);
  assert.match(js, /'workspace-local': \['workspace\.html\?mode=local'/);
});

test('wake lock follows the Keep screen awake setting and is re-taken when the page is visible again', async () => {
  const source = read('wake-lock.js').replace(/^import .*;\r?\n/gm, '');
  const storeSource = read('settings-store.js').replace(/^export /gm, '');
  const docEvents = {}; const winEvents = {}; const requests = [];
  const storage = memoryStorage();
  const makeSentinel = () => { const s = { released: false, listeners: {}, addEventListener(n, fn) { this.listeners[n] = fn; }, async release() { this.released = true; this.listeners.release?.(); } }; requests.push(s); return s; };
  const document = { hidden: false, addEventListener: (n, fn) => { docEvents[n] = fn; } };
  const context = vm.createContext({ JSON, Object, localStorage: storage, document, navigator: { wakeLock: { request: async (type) => { assert.equal(type, 'screen'); return makeSentinel(); } } }, window: { addEventListener: (n, fn) => { winEvents[n] = fn; } } });
  context.globalThis = context;
  vm.runInContext(`${storeSource}\n${source}`, context);
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
  await settle();
  assert.equal(requests.length, 1, 'on by default');
  requests[0].released = true; requests[0].listeners.release(); // the browser drops it when hidden
  document.hidden = true; docEvents.visibilitychange(); await settle();
  assert.equal(requests.length, 1, 'not requested while hidden');
  document.hidden = false; docEvents.visibilitychange(); await settle();
  assert.equal(requests.length, 2, 're-acquired on return');
  storage.setItem('impact.phoneSettings', JSON.stringify({ keepAwake: false }));
  winEvents.storage({ key: 'impact.phoneSettings' }); await settle();
  assert.equal(requests[1].released, true, 'released when turned off');
  docEvents.visibilitychange(); await settle();
  assert.equal(requests.length, 2, 'stays off');
});

test('Encouragement settings: both on by default, saved one at a time, bad values ignored, and Reset turns them back on', () => {
  const storage = memoryStorage();
  assert.equal(store.loadPhoneSettings(storage).showEncouragement, true);
  assert.equal(store.loadPhoneSettings(storage).encourageAfterResults, true);
  store.savePhoneSettings(storage, { showEncouragement: false });
  assert.deepEqual([store.loadPhoneSettings(storage).showEncouragement, store.loadPhoneSettings(storage).encourageAfterResults], [false, true]);
  store.savePhoneSettings(storage, { encourageAfterResults: false, showEncouragement: 'yes' });
  assert.deepEqual([store.loadPhoneSettings(storage).showEncouragement, store.loadPhoneSettings(storage).encourageAfterResults], [false, false]);
  store.resetPhoneSettings(storage);
  assert.deepEqual([store.loadPhoneSettings(storage).showEncouragement, store.loadPhoneSettings(storage).encourageAfterResults], [true, true]);
  const html = read('settings.html');
  assert.match(html, /Show encouraging messages/); assert.match(html, /Messages after results/);
});
