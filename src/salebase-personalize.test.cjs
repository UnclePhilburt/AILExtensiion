// Salebase phone-script personalisation: which placeholders are filled, and
// (in headless Chrome) live updates, restore, re-render and rebuttals.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { SALEBASE_SCRIPT_TEXT } = require('./fixtures/salebase-script-text.js');

const CONTENT = path.join(__dirname, '../extension/src/content/salebase-personalize.js');

// Runs the content script with just enough of a browser to reach its pure helpers.
function loadHelpers() {
  const context = vm.createContext({
    Event: class { constructor(type) { this.type = type; } },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    setTimeout, clearTimeout,
    document: { dispatchEvent() {}, addEventListener() {}, documentElement: {}, body: null, querySelectorAll: () => [] },
    chrome: { storage: { onChanged: { addListener() {} }, local: { get: async () => ({}) } }, runtime: { sendMessage: async () => ({}) } }
  });
  vm.runInContext(fs.readFileSync(CONTENT, 'utf8'), context);
  return context.__impactScriptFill;
}
const { findPlaceholders } = loadHelpers();
const fill = (text) => [...findPlaceholders(text)].map((item) => `${item.original}->${item.field}`);

test('the real script placeholders map to lead fields', () => {
  assert.deepEqual(fill('Hey, (Member)??! Hey (Member), this is Cody with American Income Life.'), ['(Member)->firstName', '(Member)->firstName']);
  assert.deepEqual(fill('Okay great, (Member)!'), ['(Member)->firstName']);
  assert.deepEqual(fill('Now, (Member), you wrote down your address as (ADDRESS).'), ['(Member)->firstName', '(ADDRESS)->address']);
  assert.deepEqual(fill('You listed your full name as NAME.'), ['NAME->fullName']);
  assert.deepEqual(fill('You also wrote down your date of birth as DOB.'), ['DOB->dob']);
  assert.deepEqual(fill('We handle some of your benefits through (Group).'), ['(Group)->group']);
  assert.deepEqual(fill('For the beneficiary on your coverage, you wrote down (Beneficiary).'), ['(Beneficiary)->beneficiary']);
  assert.deepEqual(fill('It looks like you requested # child safe kits.'), ['#->kits']);
});

test('bracketed tokens are case-insensitive and other common styles work', () => {
  assert.deepEqual(fill('(member) (Address) (MEMBER)'), ['(member)->firstName', '(Address)->address', '(MEMBER)->firstName']);
  assert.deepEqual(fill('[First Name] {first_name} {{ last_name }} [City], (State) (Zip Code) (Spouse) (Agent)'),
    ['[First Name]->firstName', '{first_name}->firstName', '{{ last_name }}->lastName', '[City]->city', '(State)->state', '(Zip Code)->zip', '(Spouse)->spouse', '(Agent)->agent']);
});

test('ordinary words and asking sentences are never treated as placeholders', () => {
  const untouched = [
    "I'm reaching out because you're one of the members who hasn't received their benefits yet.",
    'As a Union Member you get member benefits.',
    'Every Association Member and every Member of the family.',
    "It looks like you didn't put down your DOB. So, what's your DOB?",
    'What is your DOB?',
    'FULL NAME: please spell it',
    'Your name is on the card (optional) (pause) (members)',
    'You have #1 priority and # of calls',
    'I am the name you trust'
  ];
  for (const line of untouched) assert.deepEqual(fill(line), [], line);
});

// ---- Headless browser ----
const CANDIDATES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/brave-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
const browser = CANDIDATES.find((candidate) => { try { return fs.statSync(candidate).isFile(); } catch (_error) { return false; } });

function runPage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salebase-fill-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/salebase-script-text.js'), path.join(dir, 'text.js'));
  fs.copyFileSync(CONTENT, path.join(dir, 'fill.js'));
  fs.copyFileSync(path.join(__dirname, '../extension/src/content/salebase-rebuttal.js'), path.join(dir, 'rebuttal.js'));
  fs.writeFileSync(path.join(dir, 'page.html'), `<!doctype html><html><head><style>.answer{display:none}</style></head><body>
<script>
// Minimal extension APIs shared by both content scripts.
let tabListener; const storageListeners = []; window.__fillMessages = 0;
window.chrome = {
  runtime: { onMessage: { addListener: (fn) => { tabListener = fn; } }, sendMessage: async () => ({ ok: true, fields: null }) },
  storage: { local: { get: async () => ({}) }, onChanged: { addListener: (fn) => storageListeners.push(fn) } }
};
const setLead = (fields) => storageListeners.forEach((fn) => fn({ 'impact.scriptLead': { newValue: fields ? { fields } : undefined } }, 'session'));
const setEnabled = (on) => storageListeners.forEach((fn) => fn({ 'impact.fillScript': { newValue: on } }, 'local'));
</script>
<script src="text.js"></script>
<div></div><div><div></div><div></div><div></div><div></div><div></div><div>
  <select id="myDropdown"><option value="union">Union</option><option value="beneficiary">Beneficiary</option><option value="childSafe">Child Safe</option></select>
  <div id="script"></div>
  <div><div></div><div id="rebuttals"><span class="ea">Expand All</span> <span class="ca">Collapse All</span></div></div>
  <input id="notes" value="(Member)"><button id="btn">(Member)</button><a href="#x" id="link">(Member)</a>
</div></div>
<script>
// Salebase-style: the dropdown re-renders the script with innerHTML.
const render = (key) => { document.getElementById('script').innerHTML = SALEBASE_SCRIPT_TEXT[key].map((line) => '<p>' + line.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>').join(''); };
document.getElementById('myDropdown').addEventListener('change', (e) => render(e.target.value));
render('union');
const titles = ["I'm not interested.", 'Can you mail it to me?', "I don't remember doing this!", 'Do we have to do a Zoom meeting? / Do I have to do this? / Why do I have to do this?', 'What is this all about?'];
const box = document.getElementById('rebuttals');
titles.forEach((t, i) => { const w = document.createElement('span'); w.innerHTML = '<p><span></span></p><div class="answer">Rebuttal ' + i + ': I hear you, (Member).</div>'; w.querySelector('span').textContent = t; box.append(w); });
box.querySelectorAll('p').forEach((p) => p.addEventListener('click', (e) => { const n = e.target.nextElementSibling; if (n) n.style.display = n.style.display === 'block' ? 'none' : 'block'; }));
</script>
<script src="fill.js"></script>
<script src="rebuttal.js"></script>
<script>
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const scriptText = () => document.getElementById('script').innerText.replace(/\\s+/g, ' ').trim();
const send = (m) => new Promise((resolve) => tabListener(m, {}, resolve));
(async () => {
  const out = {};
  const originalHtml = document.getElementById('script').innerHTML;
  const originalRebuttals = box.innerHTML;
  await wait(150);
  out.noLead = scriptText();
  setLead({ firstName: 'James', fullName: 'James Carter', address: '123 Main St, Springfield, IL 62704', dob: '', group: '', beneficiary: '', kits: '' });
  await wait(150);
  out.leadA = scriptText();
  const span = document.querySelector('[data-impact-fill]');
  out.span = { title: span.title, original: span.getAttribute('data-impact-original'), style: span.getAttribute('style') };
  out.controls = [document.getElementById('notes').value, document.getElementById('btn').textContent, document.getElementById('link').textContent];
  out.titles = [...box.querySelectorAll('p > span')].map((s) => s.textContent);
  setLead({ firstName: 'Maria', fullName: 'Maria Lopez', address: '9 Oak Ave, Austin, TX 78701', dob: 'March 4, 1985', group: 'IBEW Local 58', beneficiary: '', kits: '' });
  await wait(150);
  out.leadB = scriptText();
  // Salebase switches scripts: the new text is filled too.
  const dd = document.getElementById('myDropdown'); dd.value = 'beneficiary'; dd.dispatchEvent(new Event('change'));
  await wait(150);
  out.rerendered = scriptText();
  dd.value = 'childSafe'; dd.dispatchEvent(new Event('change'));
  await wait(150);
  out.childSafe = scriptText();
  // No endless loop: once settled nothing keeps changing.
  let mutations = 0; const counter = new MutationObserver((list) => { mutations += list.length; }); counter.observe(document.body, { childList: true, subtree: true, characterData: true });
  await wait(400);
  out.settledMutations = mutations; counter.disconnect();
  // Rebuttals still open with the filler running (and the fill inside the body stays).
  const r = await send({ type: 'impact/revealRebuttal', label: "I'm not interested", phrases: ['not interested'], otherLabels: titles.slice(1) });
  out.rebuttal = { found: r.found, action: r.action, shown: box.querySelectorAll('.answer')[0].style.display, text: box.querySelectorAll('.answer')[0].innerText };
  // Turned off: original placeholders come back.
  setEnabled(false); await wait(150);
  out.disabled = scriptText();
  setEnabled(true); await wait(150);
  out.reenabled = scriptText();
  // No lead: exact original markup.
  dd.value = 'union'; dd.dispatchEvent(new Event('change')); await wait(150);
  setLead(null); await wait(150);
  out.restoredExact = document.getElementById('script').innerHTML === originalHtml;
  out.rebuttalsRestored = box.innerHTML.replace(/ style="[^"]*"/g, '') === originalRebuttals.replace(/ style="[^"]*"/g, '');
  out.leftovers = document.querySelectorAll('[data-impact-fill]').length;
  const pre = document.createElement('pre'); pre.id = 'out'; pre.setAttribute('data-impact-ui', ''); pre.textContent = JSON.stringify(out); document.body.append(pre);
})();
</script></body></html>`);
  try {
    const html = execFileSync(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(dir, 'profile')}`,
      '--allow-file-access-from-files', '--virtual-time-budget=15000', '--dump-dom', pathToFileURL(path.join(dir, 'page.html')).href],
    { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
    const match = html.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/);
    if (!match) return null;
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  } catch (_error) {
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_error) {}
  }
}

let page;
const getPage = () => { if (page === undefined) page = runPage(); return page; };
const skip = browser ? false : 'no Chrome/Brave found (set CHROME_PATH)';

test('headless: the lead fills the script, a new lead updates it, missing values keep their placeholder', { skip }, (t) => {
  const out = getPage(); if (!out) { t.skip('the headless browser could not run here'); return; }
  const union = SALEBASE_SCRIPT_TEXT.union.join(' ');
  assert.equal(out.noLead, union, 'no lead yet: script exactly as written');
  assert.equal(out.leadA, "Hey, James??! Hey James, this is Cody with American Income Life. We handle some of your benefits through (Group). I'm reaching out because you're one of the members who hasn't received their benefits yet. Okay great, James! You listed your full name as James Carter. You also wrote down your date of birth as DOB. You listed your address as 123 Main St, Springfield, IL 62704.");
  assert.equal(out.leadB, "Hey, Maria??! Hey Maria, this is Cody with American Income Life. We handle some of your benefits through IBEW Local 58. I'm reaching out because you're one of the members who hasn't received their benefits yet. Okay great, Maria! You listed your full name as Maria Lopez. You also wrote down your date of birth as March 4, 1985. You listed your address as 9 Oak Ave, Austin, TX 78701.");
  assert.deepEqual(out.span, { title: 'From IMPACT lead', original: '(Member)', style: out.span.style });
  assert.match(out.span.style, /font-weight:600/);
  assert.deepEqual(out.controls, ['(Member)', '(Member)', '(Member)'], 'inputs, buttons and links are left alone');
});

test('headless: switching scripts re-fills, asking sentences stay, no mutation loop', { skip }, (t) => {
  const out = getPage(); if (!out) { t.skip('the headless browser could not run here'); return; }
  assert.equal(out.rerendered, "Hey Maria, this is Cody. Now, Maria, you wrote down your address as 9 Oak Ave, Austin, TX 78701. For the beneficiary on your coverage, you wrote down (Beneficiary). It looks like you didn't put down your DOB. So, what's your DOB?");
  assert.equal(out.childSafe, 'Hey Maria, this is Cody. It looks like you requested # child safe kits. Now, Maria, you wrote down your address as 9 Oak Ave, Austin, TX 78701.');
  assert.equal(out.settledMutations, 0);
});

test('headless: rebuttal titles are untouched and the rebuttal panel still opens', { skip }, (t) => {
  const out = getPage(); if (!out) { t.skip('the headless browser could not run here'); return; }
  assert.deepEqual(out.titles, ["I'm not interested.", 'Can you mail it to me?', "I don't remember doing this!", 'Do we have to do a Zoom meeting? / Do I have to do this? / Why do I have to do this?', 'What is this all about?']);
  assert.equal(out.rebuttal.found, true);
  assert.equal(out.rebuttal.action, 'clicked-title');
  assert.equal(out.rebuttal.shown, 'block');
  assert.equal(out.rebuttal.text, 'Rebuttal 0: I hear you, Maria.');
});

test('headless: turning it off or losing the lead restores the original text exactly', { skip }, (t) => {
  const out = getPage(); if (!out) { t.skip('the headless browser could not run here'); return; }
  assert.equal(out.disabled, SALEBASE_SCRIPT_TEXT.childSafe.join(' '));
  assert.match(out.reenabled, /^Hey Maria, this is Cody/);
  assert.equal(out.restoredExact, true);
  assert.equal(out.rebuttalsRestored, true);
  assert.equal(out.leftovers, 0);
});

test('wiring: manifest, service worker and IMPACT script keep script-only details local', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
  const entry = manifest.content_scripts.find((item) => item.js.includes('src/content/salebase-personalize.js'));
  assert.deepEqual(entry.matches, ['https://salebase.ai/phone_scripts/*']);
  assert.ok(manifest.host_permissions.includes('https://salebase.ai/*'), 'no new permission needed');
  const content = fs.readFileSync(CONTENT, 'utf8');
  assert.doesNotMatch(content, /runtime\.onMessage\.addListener/, 'tab messages belong to the rebuttal script');
  assert.doesNotMatch(content, /innerHTML/);
  const worker = fs.readFileSync(path.join(__dirname, '../extension/src/background/service-worker.js'), 'utf8');
  assert.match(worker, /const \{ scriptDetails, \.\.\.lead \} = incoming \|\| \{\};/);
  assert.match(worker, /chrome\.storage\.session\.set\(\{ \[SCRIPT_LEAD_KEY\]/);
  assert.match(worker, /accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'/);
  assert.match(worker, /chrome\.tabs\.onRemoved\.addListener\(\(tabId\) => \{ void clearScriptLeadForTab\(tabId\); \}\)/);
  assert.doesNotMatch(worker.slice(worker.indexOf('function makeLeadFingerprint'), worker.indexOf('async function appendLocalLog')), /scriptDetails|dob/);
  const impact = fs.readFileSync(path.join(__dirname, '../extension/src/content/impact-diagnostic.js'), 'utf8');
  assert.match(impact, /lead\.scriptDetails = collectScriptDetails\(document\.querySelector\("#primaryPanel"\)\);\n\s*await publishCurrentLead\(lead\);/);
  assert.doesNotMatch(impact.slice(impact.indexOf('function collectLocalLeadPreview'), impact.indexOf('function collectRequestType')), /scriptDetails/, 'not in snapshots');
  const popup = fs.readFileSync(path.join(__dirname, '../extension/src/popup/popup.html'), 'utf8');
  assert.match(popup, /Fill lead details into the script/);
  assert.match(popup, /id="fillScript" type="checkbox" role="switch" checked/);
  assert.match(fs.readFileSync(path.join(__dirname, '../extension/src/popup/popup.js'), 'utf8'), /'impact\.fillScript': event\.target\.checked/);
});
