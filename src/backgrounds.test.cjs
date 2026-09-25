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

test('the boot script applies a saved choice before paint and ignores junk', () => {
  const boot = read('background-boot.js');
  assert.ok(boot.includes(`'${bg.BACKGROUND_STORAGE_KEY}'`), 'same storage key as backgrounds.js');
  const run = (saved) => {
    const root = fakeRoot();
    vm.runInNewContext(boot, { localStorage: memoryStorage(saved === undefined ? {} : { 'impact.phoneBackground': saved }), document: { documentElement: root } });
    return root.attrs['data-bg'];
  };
  assert.equal(run('aurora'), 'aurora');
  assert.equal(run(undefined), undefined);
  assert.equal(run('default'), undefined);
  assert.equal(run('"><img src=x>'), undefined);
  assert.doesNotThrow(() => vm.runInNewContext(boot, { localStorage: { getItem() { throw new Error('blocked'); } }, document: {} }));
});

test('pages load the boot script before the stylesheet and offer the Settings button', () => {
  for (const page of ['index.html', 'workspace.html', 'statistics.html']) {
    assert.match(read(page), /<script src="background-boot\.js"><\/script><link rel="stylesheet" href="styles\.css">/, page);
  }
  for (const page of ['index.html', 'workspace.html']) assert.match(read(page), /data-open-settings aria-label="Settings"/, page);
  assert.match(read('workspace-entry.js'), /import '\.\/phone-settings\.js';/);
  assert.match(read('phone-entry.js'), /import\('\.\/phone-settings\.js'\)/);
});
