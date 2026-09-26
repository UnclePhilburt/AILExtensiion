// Lead screen navigation: Settings > "Best next lead" (off by default) shows one
// full-width Next that sends best-next; off shows an even Previous / Next pair.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const PUBLIC = path.join(__dirname, '../phone-web/public');
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const strip = (source) => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const CANDIDATES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/brave-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const browser = CANDIDATES.find((candidate) => { try { return fs.statSync(candidate).isFile(); } catch (_error) { return false; } });

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); } };
}

// app.js with its imports stripped, the helpers loaded, and the cloud stubbed.
async function loadWorkspace(settings) {
  const elements = new Map(); const queried = [];
  const make = () => ({ dataset: {}, style: {}, classList: { toggle() {}, add() {} }, querySelector() { return null; }, insertBefore(item) { this.children.push(item); }, children: [], listeners: {}, value: '', hidden: false, open: true, disabled: false,
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, setAttribute() {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
  const el = (selector) => { if (!elements.has(selector)) elements.set(selector, make()); return elements.get(selector); };
  const sent = []; let authChanged;
  const lead = { available: true, leadId: 'test-a', leadName: 'Fictional A', phones: [{ label: 'Mobile', number: '555-0100', dialHref: '#sample-call' }] };
  const state = { lead, desktop_seen: new Date().toISOString(), lead_updated_at: new Date().toISOString(), device_id: 'test-computer' };
  const storage = memoryStorage(settings ? { 'impact.phoneSettings': JSON.stringify(settings) } : {});
  const context = vm.createContext({
    buildLeadProfile() {},
    client: { auth: { onAuthStateChange: (fn) => { authChanged = fn; } } }, saveLeadSchedule: async () => false, saveAppointmentChoice: async () => false, encourageLead: () => {}, encourageResult: () => {},
    cloudEnabled: async () => true, cloudState: async () => state, cloudTouchPhone: async () => {}, cloudSend: async (_s, command) => { sent.push(command.type); },
    watchCloud: async () => () => {}, visibleLead: (s) => s?.lead, isOnline: () => true,
    document: { querySelector: (selector) => { queried.push(selector); return selector.startsWith('meta') ? null : el(selector); }, createElement: make, addEventListener() {} },
    localStorage: storage, location: { search: '', origin: 'https://example.test', replace() {} },
    URLSearchParams, Date, crypto: require('node:crypto'), setInterval() {}, setTimeout() {}, clearTimeout() {}, console, navigator: {}
  });
  for (const file of ['pending-call.js', 'phone-actions.js', 'time-zone.js', 'lead-highlights.js', 'lead-rules.js', 'settings-store.js', 'lead-transition.js', 'lead-swipe.js']) vm.runInContext(strip(read(file)), context);
  const app = await vm.runInContext(`(async()=>{${strip(read('app.js'))}\nreturn {refreshCloud};})()`, context);
  authChanged('SIGNED_IN', { user: { id: 'test-user' } });
  await new Promise(setImmediate);
  return { el, sent, queried, storage, app };
}
const tap = async (button) => { await button.listeners.click(); await new Promise(setImmediate); };

test('setting off (default): Next sends next and Previous sends previous', async () => {
  const page = await loadWorkspace(null);
  assert.equal(page.el('#nextLead').disabled, false);
  assert.equal(page.el('#previousLead').disabled, false);
  await tap(page.el('#nextLead'));
  assert.deepEqual(page.sent, ['next']);
  const again = await loadWorkspace({ bestNextLead: false });
  await tap(again.el('#previousLead'));
  assert.deepEqual(again.sent, ['previous']);
  assert.ok(!page.queried.includes('#bestNextLead'), 'there is no separate Best next button any more');
});

test('setting on: the single Next button sends best-next', async () => {
  const page = await loadWorkspace({ bestNextLead: true });
  await tap(page.el('#nextLead'));
  assert.deepEqual(page.sent, ['best-next']);
  // Read at tap time, so turning it off in Settings applies without a reload.
  const live = await loadWorkspace({ bestNextLead: true });
  live.storage.setItem('impact.phoneSettings', JSON.stringify({ bestNextLead: false }));
  await tap(live.el('#nextLead'));
  assert.deepEqual(live.sent, ['next']);
});

test('workspace markup: two navigation buttons, no initials on the lead card, calm styles for every look', () => {
  const settingsPage = read('settings.html');
  assert.match(settingsPage, /<strong>Best next lead<\/strong><small>[^<]+<\/small><\/span><input id="bestNextLead" type="checkbox" role="switch" class="switch">/);
  const html = read('workspace.html');
  assert.match(html, /<section class="navControls"[^>]*><button id="previousLead" type="button" disabled>[\s\S]*?Previous[\s\S]*?<\/button><button id="nextLead" type="button" disabled>[\s\S]*?Next<\/span>[\s\S]*?<\/button><\/section>/);
  assert.doesNotMatch(html, /bestNextLead|Best next ✦|Next lead/);
  assert.doesNotMatch(read('lead-profile.js'), /monogram/i);
  assert.doesNotMatch(read('lead-profile.css'), /Monogram/);
  assert.doesNotMatch(read('styles.css'), /#bestNextLead/);
  const css = read('lead-profile.css');
  assert.match(css, /html\[data-best-next\] body \.workspace #previousLead \{ display:none; \}/);
  assert.match(css, /html\[data-best-next\] body \.workspace \.navControls \{ grid-template-columns:minmax\(0,1fr\); \}/);
  assert.match(css, /white-space:nowrap/);
  assert.match(css, /html\[data-theme="dark"\] body \.workspace \.navControls #nextLead:not\(:disabled\)/);
  assert.match(css, /html\[data-lead-paper="beige"\]:not\(\[data-theme="dark"\]\) body \.workspace \.navControls #previousLead:not\(:disabled\)/);
});

// Real layout in headless Chrome: the page's own stylesheets on a narrow phone.
function layout(rootAttrs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-nav-'));
  try {
    for (const file of ['styles.css', 'journal.css', 'lead-profile.css']) fs.copyFileSync(path.join(PUBLIC, file), path.join(dir, file));
    const html = read('workspace.html')
      .replace(/<script src="settings-boot\.js"><\/script>/, '')
      .replace(/<script type="module"[^>]*><\/script>/g, '')
      .replace('<html lang="en">', `<html lang="en" ${rootAttrs}>`)
      .replace('<main class="app workspace" hidden>', '<main class="app workspace">')
      .replace(/(\?v=\d+)"/g, '"')
      .replace('</body>', `<script>
for (const b of document.querySelectorAll('.navControls button')) b.disabled = false;
const box = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), display: getComputedStyle(el).display }; };
const nav = document.querySelector('.navControls');
const out = document.createElement('pre'); out.id = 'out';
out.textContent = JSON.stringify({ nav: box(nav), prev: box(document.getElementById('previousLead')), next: box(document.getElementById('nextLead')),
  nextBg: getComputedStyle(document.getElementById('nextLead')).backgroundImage, prevBg: getComputedStyle(document.getElementById('previousLead')).backgroundColor });
parent.document.body.append(out);
</script></body>`);
    fs.writeFileSync(path.join(dir, 'inner.html'), html);
    // An iframe gives the page a real 320px viewport (headless windows have a larger minimum width).
    fs.writeFileSync(path.join(dir, 'page.html'), '<!doctype html><html><body style="margin:0"><iframe src="inner.html" width="320" height="760" style="border:0"></iframe></body></html>');
    const dom = execFileSync(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(dir, 'profile')}`,
      '--allow-file-access-from-files', '--window-size=600,900', '--virtual-time-budget=3000', '--dump-dom', pathToFileURL(path.join(dir, 'page.html')).href],
    { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
    const match = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
    return match ? JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_error) {}
  }
}

test('headless: an even Previous / Next pair when off, one full-width Next when on, no wrapping on a 320px phone', { skip: !browser && 'no Chromium browser found' }, () => {
  for (const look of ['', 'data-theme="dark"', 'data-lead-paper="beige"', 'data-theme="dark" data-lead-paper="beige"']) {
    const pair = layout(look);
    assert.ok(pair, `page did not report (${look})`);
    assert.equal(pair.prev.display, 'flex');
    assert.ok(Math.abs(pair.prev.w - pair.next.w) <= 1, `even pair ${JSON.stringify(pair)}`);
    assert.ok(pair.prev.w + pair.next.w < pair.nav.w && pair.next.x > pair.prev.x, 'side by side');
    assert.ok(pair.prev.h <= 60 && pair.next.h <= 60, `single line ${pair.prev.h}/${pair.next.h}`);
    assert.match(pair.nextBg, /linear-gradient/, 'Next is the primary button');
    const single = layout(`${look} data-best-next`);
    assert.equal(single.prev.display, 'none');
    assert.equal(single.next.w, single.nav.w, 'Next fills the row');
    assert.ok(single.next.h <= 60);
    assert.ok(single.nav.w <= 320 && single.nav.w >= 260, `a real phone-width row (${single.nav.w}px)`);
  }
});
