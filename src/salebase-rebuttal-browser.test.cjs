// Runs the real content script in headless Chrome/Brave against a mock of the
// captured Salebase rebuttal list. Skipped when no Chromium browser is found
// (set CHROME_PATH to point at one).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/brave-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
].filter(Boolean);
const browser = CANDIDATES.find((candidate) => { try { return fs.statSync(candidate).isFile(); } catch (_error) { return false; } });

function runPage(placement, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salebase-rebuttal-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/salebase-rebuttals-shape.js'), path.join(dir, 'shape.js'));
  fs.copyFileSync(path.join(__dirname, '../extension/src/content/salebase-rebuttal.js'), path.join(dir, 'content.js'));
  fs.writeFileSync(path.join(dir, 'page.html'), `<!doctype html><html><head><style>.answer{display:none}</style></head><body>
<script>window.__clicks = []; let listener; window.chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } };
window.open = () => { window.__opened = (window.__opened || 0) + 1; return null; };</script>
<script src="shape.js"></script>
<script>const sb = buildSalebase(${JSON.stringify(placement)}, ${JSON.stringify(handler)});</script>
<script src="content.js"></script>
<script>
const send = (m) => new Promise((resolve) => listener(m, {}, resolve));
const shown = () => sb.wraps.map((w) => sb.answersOf(w).map((x) => getComputedStyle(x).display !== 'none' ? 1 : 0).join(''));
(async () => {
  const others = ['Can you mail it to me?', "I don't remember doing this!", 'Do we have to do a Zoom meeting?', 'What is this all about?'];
  const m = { type: 'impact/revealRebuttal', label: "I'm not interested", phrases: ['not interested', 'no interest'], otherLabels: others };
  const r1 = await send(m); const s1 = shown();
  const r2 = await send(m); const s2 = shown();
  const z = await send({ ...m, label: 'Do we have to do a Zoom meeting?', phrases: ['zoom meeting'], otherLabels: ["I'm not interested", ...others.slice(0, 2), others[3]] }); const s3 = shown();
  const out = document.createElement('pre'); out.id = 'out';
  out.textContent = JSON.stringify({ r1, s1, r2: r2.action, s2, z: z.action, s3, clicks: __clicks, expandAll: window.__expandAll || 0, collapseAll: window.__collapseAll || 0, opened: window.__opened || 0, href: location.href });
  document.body.append(out);
})();
</script></body></html>`);
  try {
    const html = execFileSync(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(dir, 'profile')}`,
      '--allow-file-access-from-files', '--virtual-time-budget=8000', '--dump-dom', pathToFileURL(path.join(dir, 'page.html')).href],
    { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'ignore'] });
    const match = html.match(/<pre id="out">([\s\S]*?)<\/pre>/);
    if (!match) return null;
    const decoded = match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return { result: JSON.parse(decoded), pageUrl: pathToFileURL(path.join(dir, 'page.html')).href };
  } catch (_error) {
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_error) {}
  }
}

for (const placement of ['inner', 'sibling']) {
  for (const handler of ['span', 'p', 'none']) {
    test(`headless browser: Salebase rebuttal (${placement} body, ${handler} handler) opens in place`, { skip: browser ? false : 'no Chrome/Brave found (set CHROME_PATH)' }, (t) => {
      const run = runPage(placement, handler);
      if (!run) { t.skip('the headless browser could not run here'); return; }
      const { result } = run;
      // 0.4.13: click the same element 0.4.10 clicked (the <p>, or the wrapper
      // when it only holds the title), never skip the click, then reveal.
      const titleOpens = placement === 'inner' && handler === 'p';
      assert.equal(result.r1.found, true);
      assert.equal(result.r1.header.tag, placement === 'inner' ? 'p' : 'span');
      assert.equal(result.r1.action, titleOpens ? 'clicked-title' : 'clicked-title-then-revealed');
      assert.equal(result.r1.bodyPlacement, placement === 'inner' ? 'inside-wrapper' : 'after-wrapper');
      assert.deepEqual(result.s1, ['11', '00', '00', '00', '00']);
      // Hearing it again clicks again; a toggle that closed it is re-revealed.
      assert.equal(result.r2, titleOpens ? 'clicked-title-then-revealed' : 'clicked-title');
      assert.deepEqual(result.s2, ['11', '00', '00', '00', '00']);
      assert.deepEqual(result.s3, ['11', '00', '00', '11', '00']);
      assert.deepEqual(result.clicks, ["I'm not interested.", "I'm not interested.", 'Do we have to do a Z']);
      assert.equal(result.expandAll, 0);
      assert.equal(result.collapseAll, 0);
      assert.equal(result.opened, 0);
      assert.equal(result.href, run.pageUrl);
    });
  }
}

// 0.4.13 regression: 0.4.11/0.4.12 decided a max-height accordion was
// "already open" (its text has layout boxes while clipped to 0px) and skipped
// the click, and clicked the inner <span>, which a $(e.target).next() handler
// ignores. Both left the rebuttal closed while reporting "opened".
function runVariant(style, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salebase-variant-'));
  const script = process.env.SALEBASE_CONTENT_SCRIPT || path.join(__dirname, '../extension/src/content/salebase-rebuttal.js');
  fs.copyFileSync(script, path.join(dir, 'content.js'));
  fs.writeFileSync(path.join(dir, 'page.html'), `<!doctype html><html><head><style>
.maxh .answer{display:block;max-height:0;overflow:hidden}
.maxh .answer.open{max-height:500px}
.disp .answer{display:none}
</style></head><body class="${style}">
<script>window.__clicks = []; let listener; window.chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } };</script>
<div></div><div><div></div><div></div><div></div><div></div><div></div><div><select id="myDropdown"><option>Response Card</option></select><div></div><div><div></div><div id="c"><span>Expand All</span> <span>Collapse All</span></div></div></div></div>
<script>
const titles = ["I'm not interested.", 'Can you mail it to me?', "I don't remember doing this!", 'Do we have to do a Zoom meeting? / Do I have to do this? / Why do I have to do this?', 'What is this all about?'];
const c = document.getElementById('c');
titles.forEach((t, i) => { const w = document.createElement('span'); w.innerHTML = '<p><span></span></p><div class="answer">Rebuttal ' + i + ' text.</div>'; w.querySelector('span').textContent = t; c.append(w); });
const isOpen = (a) => (${JSON.stringify(style)} === 'maxh' ? a.classList.contains('open') : a.style.display === 'block');
const toggle = (a) => { if (${JSON.stringify(style)} === 'maxh') a.classList.toggle('open'); else a.style.display = a.style.display === 'block' ? 'none' : 'block'; };
if (${JSON.stringify(handler)} === 'target-next') {
  c.querySelectorAll('p').forEach((p) => p.addEventListener('click', (e) => { __clicks.push(e.target.tagName); const n = e.target.nextElementSibling; if (n) toggle(n); }));
} else {
  document.addEventListener('click', (e) => { const p = e.target.closest('#c p'); if (!p) return; __clicks.push(e.target.tagName); toggle(p.nextElementSibling); });
}
</script>
<script src="content.js"></script>
<script>
const send = (m) => new Promise((resolve) => listener(m, {}, resolve));
const state = () => [...c.querySelectorAll('.answer')].map((a) => (isOpen(a) ? 1 : 0)).join('');
(async () => {
  const others = ['Can you mail it to me?', "I don't remember doing this!", 'Do we have to do a Zoom meeting?', 'What is this all about?'];
  const r = await send({ type: 'impact/revealRebuttal', label: "I'm not interested", phrases: ['not interested'], otherLabels: others });
  const out = document.createElement('pre'); out.id = 'out';
  out.textContent = JSON.stringify({ action: r.action, found: r.found, state: state(), clicks: __clicks });
  document.body.append(out);
})();
</script></body></html>`);
  try {
    const html = execFileSync(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(dir, 'profile')}`,
      '--allow-file-access-from-files', '--virtual-time-budget=8000', '--dump-dom', pathToFileURL(path.join(dir, 'page.html')).href],
    { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'ignore'] });
    const match = html.match(/<pre id="out">([\s\S]*?)<\/pre>/);
    if (!match) return null;
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  } catch (_error) {
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_error) {}
  }
}

for (const style of ['maxh', 'disp']) {
  for (const handler of ['target-next', 'p-delegated']) {
    test(`headless browser regression: ${style === 'maxh' ? 'max-height' : 'display'} accordion with a ${handler} handler really opens the rebuttal`, { skip: browser ? false : 'no Chrome/Brave found (set CHROME_PATH)' }, (t) => {
      const result = runVariant(style, handler);
      if (!result) { t.skip('the headless browser could not run here'); return; }
      assert.equal(result.found, true);
      assert.notEqual(result.action, 'already-open', 'never guess the panel is open and skip the click');
      assert.equal(result.action, 'clicked-title');
      assert.deepEqual(result.clicks, ['P'], 'the <p> title is clicked, once');
      assert.equal(result.state, '10000', "only the I'm not interested rebuttal is open");
    });
  }
}
