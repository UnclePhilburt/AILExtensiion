const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '../phone-web/public', file), 'utf8');
const source = read('backgrounds.js').replace(/^export /gm, '');
const bg = vm.createContext({});
vm.runInContext(`${source}\nObject.assign(this, { BACKGROUND_STORAGE_KEY, DEFAULT_BACKGROUND, BACKGROUNDS, normalizeBackground, readBackground, saveBackground, applyBackground });`, bg);

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}
function fakeRoot() {
  const attrs = {};
  return { attrs, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
}

test('8-12 choices: Default first, then solid colors and gradients, unique ids', () => {
  const ids = bg.BACKGROUNDS.map((option) => option.id);
  assert.ok(ids.length >= 8 && ids.length <= 12);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(bg.DEFAULT_BACKGROUND, 'default');
  assert.deepEqual({ ...bg.BACKGROUNDS[0] }, { id: 'default', label: 'Default', kind: 'default' });
  assert.ok(bg.BACKGROUNDS.filter((option) => option.kind === 'solid').length >= 3);
  assert.ok(bg.BACKGROUNDS.filter((option) => option.kind === 'gradient').length >= 3);
  for (const option of bg.BACKGROUNDS) assert.match(option.id, /^[a-z0-9-]{1,32}$/, 'ids pass the boot script check');
});

test('nothing saved, junk, or a removed id all mean Default', () => {
  assert.equal(bg.readBackground(memoryStorage()), 'default');
  assert.equal(bg.readBackground(memoryStorage({ 'impact.phoneBackground': 'no-such-bg' })), 'default');
  assert.equal(bg.readBackground(memoryStorage({ 'impact.phoneBackground': 'ocean' })), 'ocean');
  assert.equal(bg.readBackground({ getItem() { throw new Error('blocked'); } }), 'default');
  assert.equal(bg.readBackground(undefined), 'default');
});

test('saving stores the id, and Default clears the saved value', () => {
  const storage = memoryStorage();
  assert.equal(bg.saveBackground('midnight', storage), 'midnight');
  assert.equal(storage.data['impact.phoneBackground'], 'midnight');
  assert.equal(bg.saveBackground('default', storage), 'default');
  assert.equal('impact.phoneBackground' in storage.data, false);
  assert.equal(bg.saveBackground('bogus', memoryStorage({ 'impact.phoneBackground': 'plum' })), 'default');
  assert.doesNotThrow(() => bg.saveBackground('plum', { setItem() { throw new Error('full'); }, removeItem() {} }));
});

test('applying sets data-bg on <html>, and removes it for Default', () => {
  const root = fakeRoot();
  bg.applyBackground('sunset', root);
  assert.equal(root.attrs['data-bg'], 'sunset');
  bg.applyBackground('default', root);
  assert.equal('data-bg' in root.attrs, false);
  bg.applyBackground('<script>', root);
  assert.equal('data-bg' in root.attrs, false);
});

test('every non-default choice has page and swatch colors in styles.css, and the default keeps the original look', () => {
  const css = read('styles.css');
  for (const { id } of bg.BACKGROUNDS.slice(1)) {
    assert.ok(css.includes(`html[data-bg="${id}"], [data-bg-swatch="${id}"] { --page-bg:`), id);
  }
  assert.match(css, /:root, \[data-bg-swatch="default"\] \{ --page-bg: linear-gradient\(#123b3a 0 275px, #eff3f1 275px\);/);
  assert.match(css, /body \{ margin: 0; background: var\(--page-bg\);/);
});

test('the boot script applies a saved background before paint and ignores junk', () => {
  const boot = read('settings-boot.js');
  assert.ok(boot.includes(`'${bg.BACKGROUND_STORAGE_KEY}'`), 'same storage key as backgrounds.js');
  const run = (saved) => {
    const root = fakeRoot();
    vm.runInNewContext(boot, { localStorage: memoryStorage(saved === undefined ? {} : { 'impact.phoneBackground': saved }), document: { documentElement: root }, window: { addEventListener() {} } });
    return root.attrs['data-bg'];
  };
  assert.equal(run('aurora'), 'aurora');
  assert.equal(run(undefined), undefined);
  assert.equal(run('default'), undefined);
  assert.equal(run('"><img src=x>'), undefined);
  assert.doesNotThrow(() => vm.runInNewContext(boot, { localStorage: { getItem() { throw new Error('blocked'); } }, document: { documentElement: fakeRoot() }, window: { addEventListener() {} } }));
});

test('the old slide-up panel is gone; pages load the boot script first and link to settings.html', () => {
  for (const page of ['index.html', 'workspace.html', 'statistics.html', 'settings.html', 'calendar.html']) {
    assert.match(read(page), /<script src="settings-boot\.js"><\/script><link rel="stylesheet" href="styles\.css">/, page);
    assert.doesNotMatch(read(page), /data-open-settings|background-boot|phone-settings/, page);
  }
  assert.match(read('index.html'), /<a class="settingsButton" href="settings\.html\?from=home" aria-label="Settings"/);
  assert.match(read('statistics.html'), /<a class="settingsLink" href="settings\.html\?from=statistics">/);
  const workspace = read('workspace.html');
  const header = workspace.slice(workspace.indexOf('<header'), workspace.indexOf('</header>'));
  assert.match(header, /<a class="brand homeBrand" href="\.\/"/, 'the IMPACT logo goes back to Home');
  assert.doesNotMatch(workspace, /accountLink|calendarLink|settingsLink|headerLinks|iconLink|account\.html|calendar\.html/, 'no account, calendar or settings links on the Workspace');
  assert.equal((header.match(/<a /g) || []).length, 1, 'the logo is the only link in the header');
  assert.doesNotMatch(read('app.js'), /\.accountLink|\.settingsLink|\.calendarLink/);
  assert.equal((workspace.match(/settings\.html/g) || []).length, 0, 'no settings entry point on the Workspace');
  assert.doesNotMatch(read('styles.css'), /settingsSheet|titleRow/);
  assert.doesNotMatch(read('workspace-entry.js') + read('phone-entry.js'), /phone-settings/);
  assert.match(read('workspace-entry.js'), /import '\.\/wake-lock\.js';/);
});

test('calm Workspace: band + body layout, same controls in the same order, and every hook the app uses', () => {
  const html = read('workspace.html');
  assert.match(html, /<body class="wsPage"><main class="app workspace" hidden>\s*<div class="wsBand"><header class="wsHeader">/);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ['connectionModeLabel', 'status', 'bridgeSetup', 'bridgeUrl', 'bridgeToken', 'saveBridge', 'leadCard', 'previousLead', 'nextLead', 'pendingCallNotice', 'pendingCallText', 'dismissPendingCall', 'callResults', 'noAnswer', 'virtualAppointment', 'refusedAppointment', 'appointmentPicker', 'appointmentHint', 'appointmentDays', 'appointmentTimes', 'callHistory', 'historyCount', 'historyEntries', 'actionFeedback']) assert.ok(ids.includes(id), id);
  const results = html.slice(html.indexOf('id="callResults"'), html.indexOf('id="appointmentPicker"'));
  assert.deepEqual([...results.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]), ['No Answer', 'Voicemail', 'Contacted', 'Callback', 'Set Virtual Appointment', 'Refused Appointment', 'Bad Number', 'Notes']);
  assert.ok(html.indexOf('id="previousLead"') < html.indexOf('id="nextLead"'));
  assert.ok(html.indexOf('id="leadCard"') < html.indexOf('id="previousLead"') && html.indexOf('id="nextLead"') < html.indexOf('id="callResults"'));
  const css = read('styles.css');
  assert.match(css, /button \{[^}]*min-height: 54px/, 'result and nav buttons keep 54px targets');
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.wsBand, \.workspace \.leadCard\.empty::before \{ animation: none; \}/);
  assert.match(css, /\.workspace \.quietHoursFlag::before \{ content: "!"/, 'DO NOT KNOCK keeps a clear icon');
  assert.match(read('encouragement-ui.js'), /data-toast-avoid/);
  assert.match(html, /<div class="workspaceTop" data-toast-avoid>/, 'the toast stays below the logo row');
  assert.doesNotMatch(css, /\.wsHeader \.brandSub \{ display: none/, 'COMPANION shows at every width');
  for (const [file, back] of [['calendar.js', /workspace: \['workspace\.html', '← Workspace'\], 'workspace-local': \['workspace\.html\?mode=local'/], ['settings.js', /'workspace-local': \['workspace\.html\?mode=local', '← Workspace'\]/]]) assert.match(read(file), back, file);
});
