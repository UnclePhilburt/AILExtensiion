// Calm script view over the Salebase phone script page.
// Static checks, fixture checks (a sanitized, trimmed save of the real page)
// and headless Chrome runs of the real content scripts on that fixture.
// The browser runs are skipped when no Chromium browser is found (CHROME_PATH).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const CALM = read('extension/src/content/salebase-calm.js');
const FIXTURE = read('src/fixtures/salebase-phone-scripts.html');

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/brave-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
].filter(Boolean);
const browser = CANDIDATES.find((candidate) => { try { return fs.statSync(candidate).isFile(); } catch (_error) { return false; } });

// ---- Static ------------------------------------------------------------------
test('manifest loads the calm view after personalisation on the script page, and updates inject it', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const entry = manifest.content_scripts.find((item) => item.matches.includes('https://salebase.ai/phone_scripts/*'));
  assert.deepEqual(entry.js, ['src/content/salebase-personalize.js', 'src/content/salebase-calm.js']);
  const worker = read('extension/src/background/service-worker.js');
  assert.match(worker, /CALM_SCRIPT_CONTENT_SCRIPT = 'src\/content\/salebase-calm\.js'/);
  assert.match(worker, /files: \[SCRIPT_FILL_CONTENT_SCRIPT, CALM_SCRIPT_CONTENT_SCRIPT\]/);
});

test('"Calm script view" popup toggle defaults on and is stored like the other settings', () => {
  const html = read('extension/src/popup/popup.html');
  assert.match(html, /<h2 id="calmViewTitle">Calm script view<\/h2>/);
  assert.match(html, /<input id="calmScripts" type="checkbox" role="switch" checked>/);
  const popup = read('extension/src/popup/popup.js');
  assert.match(popup, /stored\['impact\.calmScripts'\] !== false/);
  assert.match(popup, /chrome\.storage\.local\.set\(\{ 'impact\.calmScripts': event\.target\.checked \}\)/);
  assert.match(CALM, /enabled = stored\[SETTING_KEY\] !== false/);
  assert.match(CALM, /const SETTING_KEY = 'impact\.calmScripts'/);
});

test('the calm view never hides or restyles the real page (rebuttal panel included)', () => {
  const css = CALM.match(/const CSS = `([\s\S]*?)`;/)[1];
  // Every rule lives in the view's shadow root; none may target Salebase's rebuttal panel.
  assert.doesNotMatch(css, /rebuttal-item|rebuttal-answer|rebuttalsColumn|rebuttals-content|expandAllRebuttals|right-column|script-type/);
  assert.doesNotMatch(css, /1px solid/);
  assert.match(CALM, /attachShadow\(\{ mode: 'open' \}\)/);
  // The only element whose display the view changes is its own host.
  const displayWrites = CALM.match(/\.style\.(display|visibility)\s*=/g) || [];
  const hostWrites = CALM.match(/host\.style\.display\s*=/g) || [];
  assert.equal(displayWrites.length, hostWrites.length);
  assert.doesNotMatch(CALM, /document\.(head|body)\.append|insertAdjacentHTML|adoptedStyleSheets/);
});

// ---- Fixture -------------------------------------------------------------------
test('the Salebase fixture is sanitized: no lead data, emails, phone numbers or tokens', () => {
  assert.match(FIXTURE, /<title>Phone Scripts - Salebase<\/title>/);
  assert.doesNotMatch(FIXTURE, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'email address');
  assert.doesNotMatch(FIXTURE, /\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}\b/, 'phone number');
  assert.doesNotMatch(FIXTURE, /eyJ|access_token|refresh_token|bearer|supabase|csrf|PHPSESSID|api[_-]?key|sk-[a-z0-9]/i, 'token');
  assert.doesNotMatch(FIXTURE, /data-impact-fill|<script\b|ref=TALLY/i);
  assert.doesNotMatch(FIXTURE, /[A-Za-z0-9_-]{32,}/, 'long opaque string');
  assert.match(FIXTURE, /id="agentName"[^>]*value=""/);
});

// Real structure the parser relies on, straight from the saved page.
test('fixture has the real structure: #myDropdown, one .script-type per option, rebuttal items', () => {
  const values = [...FIXTURE.matchAll(/<option value="([A-Z-]+)">/g)].map((m) => m[1]);
  const dropdownValues = values.filter((value) => !['es'].includes(value));
  assert.ok(dropdownValues.includes('RESPONSE') && dropdownValues.includes('WILLKIT') && dropdownValues.includes('FE'));
  for (const value of ['RESPONSE', 'WILLKIT', 'CHILDSAFE', 'REFERRAL', 'FE']) assert.match(FIXTURE, new RegExp(`class="script-type ${value}"`));
  assert.match(FIXTURE, /id="rebuttalsColumn"/);
  assert.match(FIXTURE, /id="expandAllRebuttals"/);
  assert.match(FIXTURE, /<p class="rebuttal-item collapsed"><span class="ConditionalChar"><i class="fas fa-chevron-right rebuttal-chevron"><\/i>/);
  assert.match(FIXTURE, /<button class="showhide" data-target="oneWillResponse">/);
});

// ---- Headless Chrome ----------------------------------------------------------------
const STUB = `<script>
window.__messages = []; const storageListeners = []; let tabListener;
const stores = { local: {}, session: {} };
const fire = (area, changes) => storageListeners.forEach((fn) => fn(changes, area));
const area = (name) => ({
  get: async (keys) => { const list = keys == null ? Object.keys(stores[name]) : [].concat(keys); const out = {}; for (const key of list) if (key in stores[name]) out[key] = stores[name][key]; return out; },
  set: async (values) => { const changes = {}; for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: stores[name][key], newValue: value }; stores[name][key] = value; } fire(name, changes); }
});
const LEAD = { firstName: 'Pat', lastName: 'Example', fullName: 'Pat Example', address: '1 Test Lane, Springfield, IL 62704', group: 'IBEW Local 58', requestType: 'Response Card', beneficiary: '', dob: '', kits: '' };
window.chrome = {
  storage: { local: area('local'), session: area('session'), onChanged: { addListener: (fn) => storageListeners.push(fn) } },
  runtime: {
    onMessage: { addListener: (fn) => { tabListener = fn; } },
    sendMessage: async (message) => { __messages.push(message); return message.type === 'impact/getScriptLead' ? { ok: true, fields: LEAD } : { ok: true }; }
  }
};
window.__calmSetting = __CALM_SETTING__;
if (window.__calmSetting !== undefined) stores.local['impact.calmScripts'] = window.__calmSetting;
const send = (message) => new Promise((resolve) => tabListener(message, {}, resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const host = () => document.getElementById('impact-calm-host');
const q = (selector) => host()?.shadowRoot?.querySelector(selector) || null;
const qa = (selector) => [...(host()?.shadowRoot?.querySelectorAll(selector) || [])];
const done = (result) => { const out = document.createElement('pre'); out.id = 'out'; out.textContent = JSON.stringify(result); document.body.append(out); };
const OTHERS = ["I'm not interested", "I don't remember doing this!", 'Do we have to do a Zoom meeting?', 'What is this all about?'];
const revealMail = async () => {
  const result = await send({ type: 'impact/revealRebuttal', label: 'Can you mail it to me?', phrases: ['mail it to me', 'send it in the mail'], otherLabels: OTHERS });
  await sleep(400);
  const item = [...document.querySelectorAll('#rebuttalsColumn .script-type.WILLKIT .rebuttal-item')].find((node) => node.textContent.includes('Can you mail it to me?'));
  const answer = item.querySelector('.rebuttal-answer') || item.nextElementSibling;
  return { ok: result.ok, found: result.found, action: result.action || '', status: result.status || '', originalOpen: !item.classList.contains('collapsed') && getComputedStyle(answer).display !== 'none', clicks: window.__rebuttalClicks || 0 };
};
</script>`;

function runPage(html, scenario, { calmSetting, budget = 20000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salebase-calm-'));
  for (const [from, to] of [['src/fixtures/salebase-page-behaviour.js', 'behaviour.js'], ['extension/src/content/salebase-personalize.js', 'personalize.js'],
    ['extension/src/content/salebase-calm.js', 'calm.js'], ['extension/src/content/salebase-rebuttal.js', 'rebuttal.js']]) fs.copyFileSync(path.join(ROOT, from), path.join(dir, to));
  const tail = `${STUB.replace('__CALM_SETTING__', JSON.stringify(calmSetting ?? null).replace('null', 'undefined'))}
<script src="behaviour.js"></script><script src="personalize.js"></script><script src="calm.js"></script><script src="rebuttal.js"></script>
<script>(async () => { ${scenario} })().catch((error) => done({ error: String(error && error.stack || error) }));</script>`;
  fs.writeFileSync(path.join(dir, 'page.html'), html.replace(/<\/body>(?![\s\S]*<\/body>)/, `${tail}</body>`));
  try {
    const out = execFileSync(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(dir, 'profile')}`,
      '--allow-file-access-from-files', '--window-size=1440,900', `--virtual-time-budget=${budget}`, '--dump-dom', pathToFileURL(path.join(dir, 'page.html')).href],
    { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
    const match = out.match(/<pre id="out">([\s\S]*?)<\/pre>/);
    if (!match) return null;
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_error) {}
  }
}

const MAIN = `
await sleep(700);
const dropdown = document.getElementById('myDropdown');
const events = []; dropdown.addEventListener('input', (e) => events.push('input:' + e.bubbles)); dropdown.addEventListener('change', (e) => events.push('change:' + e.bubbles));
const R = {};
R.initial = { active: __impactCalmView.isActive(), leadName: q('.leadName').textContent, chips: qa('.chip').map((n) => n.textContent), scripts: qa('.scripts button').length,
  current: q('.scripts button[aria-current="true"]').textContent, readTitle: q('.readHead h1').textContent, fills: qa('.read [data-impact-fill]').map((n) => n.textContent).slice(0, 2),
  originalLaidOut: document.querySelector('.left-column').getClientRects().length > 0 && document.getElementById('rebuttalsColumn').getClientRects().length > 0,
  rebuttals: qa('.rb').length, text: q('.read').textContent.replace(/\\s+/g, ' ').slice(0, 60) };
qa('.scripts button').find((b) => b.dataset.value === 'WILLKIT').click();
await sleep(400);
R.pick = { value: dropdown.value, events, selections: window.__selections || 0, readTitle: q('.readHead h1').textContent,
  originalShown: getComputedStyle(document.querySelector('.left-column .script-type.WILLKIT')).display, viewHasWill: q('.read').textContent.includes('Will Kits you ordered have just arrived'),
  firstRebuttal: qa('.rb > button')[0]?.textContent, current: q('.scripts button[aria-current="true"]').textContent };
qa('.read button').find((b) => b.textContent.trim() === '1 Will Kit').click();
await sleep(300);
R.response = { original: document.getElementById('oneWillResponse').style.display, view: q('.read').textContent.includes('Do you have a spouse or significant other') };
qa('.tool').find((b) => b.textContent === 'Single').click();
await sleep(300);
R.single = { checked: document.getElementById('singleCheckbox').checked, pressed: qa('.tool').find((b) => b.textContent === 'Single').getAttribute('aria-pressed'),
  view: q('.read').textContent.includes("Perfect — I'll have that one ready"), coupleGone: !q('.read').textContent.includes('Do you have a spouse or significant other') };
R.reveal = await revealMail();
const mailCard = qa('.rb').find((n) => n.textContent.includes('Can you mail it to me?'));
R.reveal.card = { open: mailCard.classList.contains('open'), hit: mailCard.classList.contains('hit'), body: mailCard.querySelector('.body').textContent.trim().slice(0, 40) };
await chrome.storage.local.set({ 'impact.lastObjection': { label: 'How long will this take?', at: Date.now(), status: 'looking' } });
await sleep(200);
const longCard = qa('.rb').find((n) => n.textContent.includes('How long will this take?'));
R.objection = { heard: !q('.heard').hidden, label: q('.heard .label span').textContent, open: longCard.classList.contains('open'), hit: longCard.classList.contains('hit') };
const input = q('.search input'); input.value = 'spouse'; input.dispatchEvent(new Event('input', { bubbles: true }));
await sleep(50);
R.search = qa('.rb > button').map((b) => b.textContent);
input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
qa('.tool').find((b) => b.textContent === 'Original page').click();
await sleep(100);
R.originalButton = { appHidden: q('.app').hidden, pill: !q('.pill').hidden, pointer: host().style.pointerEvents };
q('.pill').click();
await sleep(100);
R.originalButton.back = !q('.app').hidden && q('.pill').hidden;
const outline = document.createElement('div'); outline.id = 'impact-companion-picker-outline'; document.documentElement.append(outline);
await sleep(150);
R.picker = { hidden: host().style.display === 'none' };
outline.remove();
await sleep(200);
R.picker.back = host().style.display !== 'none' && __impactCalmView.isActive();
await chrome.storage.local.set({ 'impact.calmScripts': false });
R.toggleOff = { host: Boolean(host()), dropdown: Boolean(document.getElementById('myDropdown')), leftVisible: document.querySelector('.left-column').getClientRects().length > 0 };
await chrome.storage.local.set({ 'impact.calmScripts': true });
await sleep(200);
R.toggleOn = __impactCalmView.isActive();
R.fallbackLogs = __messages.filter((m) => m.type === 'impact/log').map((m) => m.entry.event);
done(R);`;

test('headless: the calm view renders and drives the real page', { skip: !browser && 'no Chromium browser found' }, () => {
  const R = runPage(FIXTURE, MAIN);
  assert.ok(R, 'page did not report');
  assert.equal(R.error, undefined, R.error);
  assert.equal(R.initial.active, true);
  assert.equal(R.initial.leadName, 'Pat Example');
  assert.deepEqual(R.initial.chips, ['IBEW Local 58', 'Response Card', 'Child Safe']);
  assert.equal(R.initial.scripts, 13);
  assert.equal(R.initial.current, 'Child Safe');
  assert.equal(R.initial.readTitle, 'Child Safe');
  assert.deepEqual(R.initial.fills, ['Pat', 'Pat'], 'lead fills from salebase-personalize.js show in the view');
  assert.equal(R.initial.originalLaidOut, true, 'the real page stays laid out under the view');
  assert.ok(R.initial.rebuttals >= 5);
  // Picker -> #myDropdown + input/change (bubbling) -> Salebase switches -> view re-reads.
  assert.equal(R.pick.value, 'WILLKIT');
  assert.deepEqual(R.pick.events, ['input:true', 'change:true']);
  assert.equal(R.pick.selections, 1, 'Salebase onchange="handleSelection()" ran');
  assert.equal(R.pick.originalShown, 'inline');
  assert.equal(R.pick.readTitle, 'Will Kit');
  assert.equal(R.pick.current, 'Will Kit');
  assert.equal(R.pick.viewHasWill, true);
  assert.equal(R.pick.firstRebuttal, "I'm not interested.");
  // Buttons in the view click the real ones.
  assert.deepEqual(R.response, { original: 'inline', view: true });
  assert.deepEqual(R.single, { checked: true, pressed: 'true', view: true, coupleGone: true });
  // The existing rebuttal click path runs on the real page; the matching card opens and is highlighted.
  assert.equal(R.reveal.ok, true);
  assert.equal(R.reveal.found, true);
  assert.equal(R.reveal.originalOpen, true);
  assert.equal(R.reveal.card.open, true);
  assert.equal(R.reveal.card.hit, true);
  assert.match(R.reveal.card.body, /exactly what I'm going to do/);
  // Listener objection -> card.
  assert.equal(R.objection.heard, true);
  assert.equal(R.objection.label, 'How long will this take?');
  assert.equal(R.objection.open, true);
  assert.equal(R.objection.hit, true);
  assert.ok(R.search.length >= 1 && R.search.every((title) => /spouse|kit|will|interested|mail|long|help|remember|set up|want|ordered/i.test(title)));
  assert.ok(R.search.includes('Why does my spouse need to be there?'));
  assert.deepEqual(R.originalButton, { appHidden: true, pill: true, pointer: 'none', back: true });
  assert.deepEqual(R.picker, { hidden: true, back: true });
  assert.deepEqual(R.toggleOff, { host: false, dropdown: true, leftVisible: true });
  assert.equal(R.toggleOn, true);
  assert.deepEqual(R.fallbackLogs, []);
});

const REVEAL_ONLY = `
await sleep(700);
const dropdown = document.getElementById('myDropdown');
dropdown.value = 'WILLKIT'; dropdown.dispatchEvent(new Event('change', { bubbles: true }));
await sleep(300);
const reveal = await revealMail();
done({ reveal, active: Boolean(window.__impactCalmView && __impactCalmView.isActive()) });`;

test('headless: rebuttal opening behaves exactly the same with the calm view on and off', { skip: !browser && 'no Chromium browser found' }, () => {
  const on = runPage(FIXTURE, REVEAL_ONLY, { calmSetting: true });
  const off = runPage(FIXTURE, REVEAL_ONLY, { calmSetting: false });
  assert.ok(on && off, 'page did not report');
  assert.equal(on.active, true);
  assert.equal(off.active, false);
  assert.deepEqual(on.reveal, off.reveal);
  assert.equal(on.reveal.found, true);
  assert.equal(on.reveal.originalOpen, true);
});

test('headless: an unreadable page falls back to the original page and logs why', { skip: !browser && 'no Chromium browser found' }, () => {
  const noDropdown = runPage(FIXTURE.replace('id="myDropdown"', 'id="someOtherSelect"'), `
await sleep(9000);
done({ host: Boolean(host()), logs: __messages.filter((m) => m.type === 'impact/log').map((m) => [m.entry.event, m.entry.details.reason]),
  pageVisible: document.querySelector('.left-column').getClientRects().length > 0 });`, { budget: 20000 });
  assert.ok(noDropdown, 'page did not report');
  assert.deepEqual(noDropdown, { host: false, logs: [['salebase.calmFallback', 'no-dropdown']], pageVisible: true });

  const lost = runPage(FIXTURE, `
await sleep(700);
const before = __impactCalmView.isActive();
document.querySelectorAll('.left-column .script-type').forEach((node) => node.remove());
await sleep(400);
done({ before, host: Boolean(host()), logs: __messages.filter((m) => m.type === 'impact/log').map((m) => [m.entry.event, m.entry.details.reason]) });`, { budget: 12000 });
  assert.ok(lost, 'page did not report');
  assert.equal(lost.before, true);
  assert.equal(lost.host, false, 'never a blank screen: the view goes away');
  assert.deepEqual(lost.logs, [['salebase.calmFallback', 'no-script-blocks']]);
});
