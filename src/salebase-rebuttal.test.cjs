const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadModule() {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/background/salebase-rebuttal.js'), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({ URL, setTimeout, console, Promise });
  vm.runInContext(`${source}\nthis.api = { describeOutcome, salebaseUrlInfo, isSalebaseScriptUrl, rankScriptTabs, chooseScriptTab, revealRebuttalInScriptTab, SALEBASE_TAB_QUERY, REBUTTAL_CONTENT_SCRIPT };`, context);
  return context.api;
}

const MATCH = { id: 'not-interested', label: "I'm not interested", phrases: ['not interested', 'no interest'] };
const SCRIPT_URL = 'https://salebase.ai/phone_scripts/phone_scripts.php';

// A fake chrome API that records everything and fails loudly if anything
// tries to open a tab or window.
function fakeChrome({ tabs, probes = {}, injected = true, onReveal } = {}) {
  const calls = { query: [], sendMessage: [], executeScript: [], focus: [], activate: [], remove: [], created: [] };
  const created = new Set();
  const injectedTabs = new Set(injected ? tabs.map((tab) => tab.id) : []);
  const chromeApi = {
    tabs: {
      async query(filter) { calls.query.push(filter); return tabs; },
      async sendMessage(tabId, message) {
        calls.sendMessage.push({ tabId, type: message.type, label: message.label, phrases: message.phrases });
        if (!injectedTabs.has(tabId)) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (message.type === 'impact/probeRebuttal') return probes[tabId] ?? { ok: true, isScriptPage: false, hasRebuttal: false };
        if (message.type === 'impact/revealRebuttal') {
          onReveal?.({ tabId, fireCreated: (tab) => created.forEach((listener) => listener(tab)) });
          return { ok: true, found: true, action: 'clicked-toggle' };
        }
        return null;
      },
      async update(tabId, props) { calls.activate.push({ tabId, props }); return {}; },
      async remove(tabId) { calls.remove.push(tabId); },
      async create(props) { calls.created.push(props); throw new Error('tabs.create must never be called for a rebuttal'); },
      onCreated: { addListener: (fn) => created.add(fn), removeListener: (fn) => created.delete(fn) }
    },
    windows: {
      async update(windowId, props) { calls.focus.push({ windowId, props }); return {}; },
      async create(props) { calls.created.push(props); throw new Error('windows.create must never be called for a rebuttal'); }
    },
    scripting: {
      async executeScript(options) {
        calls.executeScript.push(options);
        if (options.files) options.files.length && injectedTabs.add(options.target.tabId);
        return [{ result: undefined }];
      }
    }
  };
  return { chromeApi, calls, listeners: created };
}

test('Salebase script URLs are recognised on the bare and www host, but not other sites or the dashboard', () => {
  const { isSalebaseScriptUrl, salebaseUrlInfo } = loadModule();
  assert.equal(isSalebaseScriptUrl(SCRIPT_URL), true);
  assert.equal(isSalebaseScriptUrl('https://salebase.ai/phone_scripts/phone_scripts.php?script=12#top'), true);
  assert.equal(isSalebaseScriptUrl('https://www.salebase.ai/phone_scripts/phone_scripts.php'), true);
  assert.equal(isSalebaseScriptUrl('https://salebase.ai/dashboard/index.php'), false);
  assert.equal(isSalebaseScriptUrl('https://salebase.ai/login.php?next=/phone_scripts/'), false);
  assert.equal(isSalebaseScriptUrl('https://notsalebase.ai/phone_scripts/x.php'), false);
  assert.equal(isSalebaseScriptUrl('http://salebase.ai/phone_scripts/x.php'), false);
  assert.equal(salebaseUrlInfo('not a url').salebase, false);
});

test('tab choice prefers the tab that actually shows the script and the rebuttal', () => {
  const { chooseScriptTab } = loadModule();
  const tabs = [
    { id: 1, windowId: 10, url: 'https://salebase.ai/dashboard/', active: true, lastAccessed: 900 },
    { id: 2, windowId: 20, url: SCRIPT_URL, active: false, lastAccessed: 100 },
    { id: 3, windowId: 30, url: SCRIPT_URL, active: true, lastAccessed: 50 },
    { id: 4, windowId: 40, url: 'https://example.com/phone_scripts/', active: true }
  ];
  // Without probes: script URL beats the dashboard, active tab wins the tie.
  assert.equal(chooseScriptTab(tabs).id, 3);
  // The tab whose page really contains the rebuttal wins.
  assert.equal(chooseScriptTab(tabs, { 2: { isScriptPage: true, hasRebuttal: true }, 3: { isScriptPage: true, hasRebuttal: false } }).id, 2);
  // A script page found by its #myDropdown even at an unexpected URL is usable.
  assert.equal(chooseScriptTab([{ id: 7, url: 'https://salebase.ai/something/else.php' }], { 7: { isScriptPage: true } }).id, 7);
  // Only a dashboard or unrelated site: nothing to use.
  assert.equal(chooseScriptTab([tabs[0], tabs[3]]), null);
  // Most recently used wins when everything else is equal.
  assert.equal(chooseScriptTab([{ id: 8, url: SCRIPT_URL, lastAccessed: 1 }, { id: 9, url: SCRIPT_URL, lastAccessed: 5 }]).id, 9);
});

test('with no Salebase script window open it reports that and opens nothing', async () => {
  const { revealRebuttalInScriptTab } = loadModule();
  for (const tabs of [[], [{ id: 1, windowId: 10, url: 'https://salebase.ai/dashboard/' }]]) {
    const { chromeApi, calls } = fakeChrome({ tabs });
    const result = await revealRebuttalInScriptTab(chromeApi, MATCH, { guardMs: 0 });
    assert.equal(result.status, 'no-script-window');
    assert.match(result.message, /No Salebase script window/);
    assert.deepEqual(calls.created, []);
    assert.deepEqual(calls.focus, []);
    assert.deepEqual(calls.activate, []);
    assert.equal(calls.sendMessage.filter((call) => call.type === 'impact/revealRebuttal').length, 0);
  }
});

test('the existing script tab is focused and only that tab opens the rebuttal in place', async () => {
  const { revealRebuttalInScriptTab, SALEBASE_TAB_QUERY } = loadModule();
  const tabs = [
    { id: 2, windowId: 20, url: SCRIPT_URL, active: false },
    { id: 3, windowId: 30, url: SCRIPT_URL, active: true },
    { id: 5, windowId: 50, url: 'https://salebase.ai/dashboard/', active: true }
  ];
  const { chromeApi, calls } = fakeChrome({ tabs, probes: { 2: { ok: true, isScriptPage: true, hasRebuttal: true }, 3: { ok: true, isScriptPage: true, hasRebuttal: false } } });
  const result = await revealRebuttalInScriptTab(chromeApi, MATCH, { guardMs: 0 });
  assert.equal(result.status, 'opened');
  assert.equal(result.tabId, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.query[0].url)), [...SALEBASE_TAB_QUERY]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.focus)), [{ windowId: 20, props: { focused: true } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.activate)), [{ tabId: 2, props: { active: true } }]);
  const reveals = calls.sendMessage.filter((call) => call.type === 'impact/revealRebuttal');
  assert.equal(reveals.length, 1);
  assert.equal(reveals[0].tabId, 2);
  assert.equal(reveals[0].label, MATCH.label);
  assert.deepEqual([...reveals[0].phrases], MATCH.phrases);
  assert.deepEqual(calls.created, []);
  // No tab is ever navigated: tabs.update only activates.
  assert.ok(calls.activate.every((call) => Object.keys(call.props).join() === 'active'));
});

test('the rebuttal content script is injected when it is not already in the script tab', async () => {
  const { revealRebuttalInScriptTab, REBUTTAL_CONTENT_SCRIPT } = loadModule();
  const tabs = [{ id: 2, windowId: 20, url: SCRIPT_URL }];
  const { chromeApi, calls } = fakeChrome({ tabs, injected: false });
  const result = await revealRebuttalInScriptTab(chromeApi, MATCH, { guardMs: 0 });
  assert.equal(result.status, 'opened');
  const injections = calls.executeScript.filter((call) => call.files);
  assert.equal(injections.length, 1);
  assert.deepEqual([...injections[0].files], [REBUTTAL_CONTENT_SCRIPT]);
  assert.equal(REBUTTAL_CONTENT_SCRIPT, 'src/content/salebase-rebuttal.js');
  assert.ok(fs.existsSync(path.join(__dirname, '../extension', REBUTTAL_CONTENT_SCRIPT)));
  assert.deepEqual(calls.created, []);
});

test('a tab or popup that Salebase tries to open during the reveal is blocked and closed', async () => {
  const { revealRebuttalInScriptTab } = loadModule();
  const tabs = [{ id: 2, windowId: 20, url: SCRIPT_URL }];
  const { chromeApi, calls, listeners } = fakeChrome({
    tabs,
    onReveal: ({ fireCreated }) => {
      fireCreated({ id: 99, openerTabId: 2, pendingUrl: 'https://salebase.ai/phone_scripts/phone_scripts.php?x=1' });
      fireCreated({ id: 100, openerTabId: 77, pendingUrl: 'https://example.com/' }); // unrelated tab is left alone
    }
  });
  const result = await revealRebuttalInScriptTab(chromeApi, MATCH, { guardMs: 0 });
  assert.deepEqual(calls.remove, [99]);
  assert.deepEqual([...result.closedTabs], ['https://salebase.ai/phone_scripts/phone_scripts.php']);
  assert.equal(listeners.size, 0, 'the temporary tab listener is removed afterwards');
  const guard = calls.executeScript.find((call) => call.world === 'MAIN');
  assert.ok(guard, 'window.open is blocked in the page while the panel opens');
  assert.equal(guard.target.tabId, 2);
});

// ---- Content script against a tiny fake DOM ----

class FakeElement {
  constructor(win, tag, attrs = {}, children = [], text = '') {
    this.win = win; this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = []; this.parentElement = null;
    this.ownText = text; this.clicks = 0; this.onClick = null; this.hidden = Boolean(attrs.hidden !== undefined);
    this.style = { display: attrs['data-display'] || '', outline: '' };
    const self = this;
    this.classList = {
      contains: (name) => String(self.attrs.class || '').split(/\s+/).includes(name),
      add: (...names) => { const set = new Set(String(self.attrs.class || '').split(/\s+/).filter(Boolean)); names.forEach((n) => set.add(n)); self.attrs.class = [...set].join(' '); },
      remove: (...names) => { self.attrs.class = String(self.attrs.class || '').split(/\s+/).filter((n) => n && !names.includes(n)).join(' '); }
    };
    for (const child of children) { child.parentElement = this; this.children.push(child); }
  }
  get id() { return this.attrs.id || ''; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  get textContent() { return [this.ownText, ...this.children.map((child) => child.textContent)].join(' '); }
  get firstElementChild() { return this.children[0] || null; }
  get innerText() {
    if (!this.getClientRects().length) return '';
    return [this.ownText, ...this.children.map((child) => child.innerText)].join(' ');
  }
  get nextElementSibling() { const list = this.parentElement?.children || []; return list[list.indexOf(this) + 1] || null; }
  getClientRects() {
    for (let node = this; node; node = node.parentElement) {
      if (node.hidden || node.style.display === 'none') return [];
      if (node.classList.contains('collapse') && !node.classList.contains('show') && !node.classList.contains('in')) return [];
    }
    return [{}];
  }
  scrollIntoView(options) { this.scrolled = options || true; }
  click() {
    this.clicks += 1;
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const listener of [...this.win.listeners]) listener(event);
    for (let node = this; node; node = node.parentElement) node.onClick?.(event);
    if (event.defaultPrevented) return;
    for (let node = this; node; node = node.parentElement) {
      if (node.tagName === 'A' && node.hasAttribute('href') && !node.attrs.href.startsWith('#')) {
        this.win.navigations.push({ href: node.attrs.href, target: node.attrs.target || '' });
        return;
      }
    }
  }
}

function loadContentScript(build) {
  const win = { listeners: new Set(), navigations: [] };
  const h = (tag, attrs, children = [], text = '') => new FakeElement(win, tag, attrs, children, text);
  const body = h('body', {}, build(h));
  const all = (node) => [node, ...node.children.flatMap(all)];
  const document = { body, getElementById: (id) => all(body).find((node) => node.id === id) || null };
  let listener = null;
  const context = vm.createContext({
    URL, console, Date, Promise, document,
    // Waits run fast; the 2.5 s highlight fade never runs so it can be checked.
    setTimeout: (fn, ms) => (ms >= 2000 ? 0 : setTimeout(fn, Math.min(ms, 20))),
    location: { href: SCRIPT_URL },
    chrome: { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } },
    addEventListener: (_type, fn) => win.listeners.add(fn),
    removeEventListener: (_type, fn) => win.listeners.delete(fn)
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/src/content/salebase-rebuttal.js'), 'utf8'), context);
  const send = (message) => new Promise((resolve) => { listener(message, {}, resolve); });
  return { send, win, byId: document.getElementById };
}

const reveal = { type: 'impact/revealRebuttal', label: MATCH.label, phrases: MATCH.phrases };

test('a collapsed in-page panel is opened by its own toggle without navigating', async () => {
  let toggle;
  const page = loadContentScript((h) => {
    toggle = h('a', { 'data-toggle': 'collapse', href: '#rebuttal-1', 'aria-expanded': 'false' }, [], "I'm not interested");
    const body = h('div', { id: 'rebuttal-1', class: 'panel-collapse collapse' }, [], 'I understand, most people say that at first...');
    toggle.onClick = (event) => { event.preventDefault(); body.classList.add('in'); toggle.setAttribute('aria-expanded', 'true'); };
    return [
      h('select', { id: 'myDropdown' }, [h('option', {}, [], 'Response Card')]),
      h('script', {}, [], "var rebuttals = ['not interested'];"),
      h('div', { class: 'panel panel-default' }, [h('div', { class: 'panel-heading' }, [h('h4', { class: 'panel-title' }, [toggle])]), body])
    ];
  });
  assert.deepEqual({ ...(await page.send({ type: 'impact/probeRebuttal', label: MATCH.label, phrases: MATCH.phrases })) }, { ok: true, isScriptPage: true, hasRebuttal: true, matchKind: 'label-exact' });
  const result = await page.send(reveal);
  assert.equal(result.found, true);
  assert.equal(result.action, 'clicked-toggle');
  assert.equal(result.bodyShown, true);
  assert.equal(result.forcedVisible, false);
  assert.equal(toggle.clicks, 1);
  assert.ok(toggle.scrolled);
  assert.deepEqual(page.win.navigations, []);
  // Hearing the same objection again must not collapse the open panel.
  const again = await page.send(reveal);
  assert.equal(again.action, 'already-open');
  assert.equal(toggle.clicks, 1);
});

test('a link that would open a new Salebase tab is never clicked; the in-page panel is used instead', async () => {
  let link; let header; let body;
  const page = loadContentScript((h) => {
    link = h('a', { href: '/phone_scripts/rebuttal.php?id=3', target: '_blank' }, [], "I'm not interested");
    header = h('div', { class: 'rebuttal-header', onclick: 'toggleRebuttal(this)' }, [], "I'm not interested");
    body = h('div', { class: 'rebuttal-body', 'data-display': 'none' }, [], 'Totally fair...');
    header.onClick = () => { body.style.display = 'block'; };
    return [h('nav', {}, [link]), h('div', { class: 'rebuttals' }, [header, body])];
  });
  const result = await page.send(reveal);
  assert.equal(result.action, 'clicked-toggle');
  assert.equal(result.header.classes, 'rebuttal-header');
  assert.equal(link.clicks, 0);
  assert.equal(header.clicks, 1);
  assert.equal(result.bodyShown, true);
  assert.deepEqual(page.win.navigations, []);
});

test('when the only match is a navigating link, the panel is revealed in place and the link is left alone', async () => {
  let link; let body;
  const page = loadContentScript((h) => {
    link = h('a', { href: 'https://salebase.ai/phone_scripts/phone_scripts.php?rebuttal=2', target: '_blank', onclick: "window.open(this.href); return false;" }, [], "I'm not interested");
    body = h('div', { class: 'answer', hidden: '' }, [], 'Most people feel that way...');
    return [h('div', { class: 'item' }, [link, body])];
  });
  const result = await page.send(reveal);
  assert.equal(result.found, true);
  assert.equal(result.action, 'skipped-navigating-link');
  assert.match(result.skippedLink.reason, /onclick opens|target=_blank/);
  assert.equal(result.skippedLink.href.includes('?'), false, 'query strings are not logged');
  assert.equal(link.clicks, 0);
  assert.equal(result.forcedVisible, true);
  assert.equal(body.getClientRects().length, 1);
  assert.deepEqual(page.win.navigations, []);
});

test('a click that bubbles into a navigating link is prevented', async () => {
  let span;
  const page = loadContentScript((h) => {
    span = h('span', { role: 'button' }, [], "I'm not interested");
    return [h('a', { href: '/other.php', target: '_blank' }, [span])];
  });
  const result = await page.send(reveal);
  assert.equal(result.action, 'skipped-navigating-link');
  assert.equal(span.clicks, 0);
  assert.deepEqual(page.win.navigations, []);
});

test('details/summary rebuttals are opened and missing rebuttals are reported with debug info', async () => {
  let details;
  const page = loadContentScript((h) => {
    details = h('details', {}, [h('summary', {}, [], 'Can you mail it to me?'), h('p', {}, [], 'Sure, but...')]);
    return [details];
  });
  const opened = await page.send({ type: 'impact/revealRebuttal', label: 'Can you mail it to me?', phrases: ['mail it to me'] });
  assert.equal(opened.action, 'opened-details');
  assert.equal(details.open, true);
  const missing = await page.send({ type: 'impact/revealRebuttal', label: 'Do we have to do a Zoom meeting?', phrases: ['zoom meeting'] });
  assert.equal(missing.found, false);
  assert.equal(missing.candidates, 0);
  assert.equal(missing.isScriptPage, false);
});

// Cody's capture: container div > "Expand All", "Collapse All", then one span
// wrapper per rebuttal starting with <p><span>Title</span></p>.
const SALEBASE_TITLES = ["I'm not interested.", 'Can you mail it to me?', "I don't remember doing this!", 'Do we have to do a Zoom meeting? / Do I have to do this? / Why do I have to do this?', 'What is this all about?'];
const OTHER_LABELS = ['Can you mail it to me?', "I don't remember doing this!", 'Do we have to do a Zoom meeting?', 'What is this all about?'];

function salebaseShape(placement, handlerOn) {
  const state = { wraps: [], bodies: [], expandAll: 0, collapseAll: 0 };
  const page = loadContentScript((h) => {
    const expand = h('span', {}, [], 'Expand All');
    const collapse = h('span', {}, [], 'Collapse All');
    const children = [expand, collapse];
    SALEBASE_TITLES.forEach((title, index) => {
      const titleSpan = h('span', {}, [], title);
      const body = [h('div', { 'data-display': 'none' }, [], `Rebuttal ${index} first paragraph.`), h('p', { 'data-display': 'none' }, [], `Rebuttal ${index} second paragraph.`)];
      const wrap = h('span', {}, placement === 'inside-wrapper' ? [h('p', {}, [titleSpan]), ...body] : [h('p', {}, [titleSpan])]);
      state.wraps.push({ wrap, titleSpan, p: wrap.children[0], body });
      children.push(wrap);
      if (placement === 'after-wrapper') children.push(...body);
    });
    const container = h('div', {}, children);
    // jQuery-style delegated handler on the container: $(container).on('click', 'p > span', toggle)
    container.onClick = (event) => {
      if (event.target === expand) { state.expandAll += 1; return; }
      if (event.target === collapse) { state.collapseAll += 1; return; }
      const hit = state.wraps.find((item) => (handlerOn === 'title-span' ? item.titleSpan === event.target : [item.titleSpan, item.p].includes(event.target)));
      if (!hit || handlerOn === 'none') return;
      hit.body.forEach((part) => { part.style.display = part.style.display === 'block' ? 'none' : 'block'; });
    };
    const select = h('select', { id: 'myDropdown' }, [h('option', {}, [], 'Response Card')]);
    return [h('div', {}), h('div', {}, [h('div', {}), h('div', {}), h('div', {}), h('div', {}), h('div', {}), h('div', {}, [select, h('div', {}, [h('div', {}), container])])])];
  });
  const open = () => state.wraps.map((item) => item.body.map((part) => (part.getClientRects().length ? 1 : 0)).join(''));
  return { page, state, open };
}

for (const placement of ['inside-wrapper', 'after-wrapper']) {
  for (const handlerOn of ['title-span', 'title-or-p', 'none']) {
    test(`Salebase panel (${placement}, handler: ${handlerOn}) opens in place, only that rebuttal, and stays open`, async () => {
      const { page, state, open } = salebaseShape(placement, handlerOn);
      const message = { ...reveal, otherLabels: OTHER_LABELS };
      const first = await page.send(message);
      assert.equal(first.found, true);
      // 0.4.13: the element 0.4.10 clicked (the <p>, or the wrapper when it
      // only holds the title), clicked every time, then revealed if needed.
      const clicked = placement === 'inside-wrapper' ? state.wraps[0].p : state.wraps[0].wrap;
      const titleOpens = placement === 'inside-wrapper' && handlerOn === 'title-or-p';
      assert.equal(first.header.tag, placement === 'inside-wrapper' ? 'p' : 'span');
      assert.equal(first.header.text, "I'm not interested.");
      assert.equal(first.bodyPlacement, placement);
      assert.equal(first.bodyParts, 2);
      assert.equal(first.action, titleOpens ? 'clicked-title' : 'clicked-title-then-revealed');
      assert.equal(first.forcedVisible, !titleOpens);
      assert.equal(clicked.clicks, 1, 'the title element 0.4.10 clicked is clicked');
      assert.equal(state.wraps[0].titleSpan.clicks, 0);
      assert.deepEqual(open(), ['11', '00', '00', '00', '00']);
      assert.ok(state.wraps[0].wrap.scrolled, 'scrolls to the wrapper');
      assert.equal(state.wraps[0].wrap.style.outline, '3px solid #f59e0b');
      // Same objection again: clicked again (no "already open" guess), and a
      // toggle that closed it is re-revealed, so it ends up open.
      const again = await page.send(message);
      assert.equal(again.action, titleOpens ? 'clicked-title-then-revealed' : 'clicked-title');
      assert.equal(clicked.clicks, 2);
      assert.deepEqual(open(), ['11', '00', '00', '00', '00']);
      // A different objection opens only its own panel.
      const zoom = await page.send({ type: 'impact/revealRebuttal', label: 'Do we have to do a Zoom meeting?', phrases: ['zoom meeting'], otherLabels: [MATCH.label, ...OTHER_LABELS.filter((label) => !/Zoom/.test(label))] });
      assert.equal(zoom.header.text, SALEBASE_TITLES[3].slice(0, 80));
      assert.deepEqual(open(), ['11', '00', '00', '11', '00']);
      assert.equal(state.expandAll, 0, 'Expand All is never clicked');
      assert.equal(state.collapseAll, 0, 'Collapse All is never clicked');
      assert.deepEqual(page.win.navigations, []);
    });
  }
}

// 0.4.13 regression: a panel whose body has layout boxes and text while it is
// collapsed (max-height:0 / overflow:hidden, opacity) looked "already open" to
// 0.4.12, which then clicked nothing and still reported "opened".
test('a collapsed panel that still has layout boxes is clicked open, never skipped as already open', async () => {
  let p; let answer;
  const page = loadContentScript((h) => {
    const wraps = ["I'm not interested.", 'Can you mail it to me?', "I don't remember doing this!", 'What is this all about?'].map((title, index) => {
      const titleP = h('p', {}, [h('span', {}, [], title)]);
      const body = h('div', { class: 'answer' }, [], `Rebuttal ${index} text.`); // "visible" in the fake DOM
      titleP.onClick = (event) => { if (event.target === titleP) body.setAttribute('data-open', body.getAttribute('data-open') === '1' ? '0' : '1'); };
      if (index === 0) { p = titleP; answer = body; }
      return h('span', {}, [titleP, body]);
    });
    const container = h('div', {}, [h('span', {}, [], 'Expand All'), h('span', {}, [], 'Collapse All'), ...wraps]);
    return [h('select', { id: 'myDropdown' }, [h('option', {}, [], 'Response Card')]), container];
  });
  const result = await page.send({ ...reveal, otherLabels: OTHER_LABELS });
  assert.equal(result.found, true);
  assert.notEqual(result.action, 'already-open');
  assert.equal(result.action, 'clicked-title');
  assert.equal(p.clicks, 1, 'the <p> title is clicked like 0.4.10 did');
  assert.equal(answer.getAttribute('data-open'), '1', 'the page handler opened it');
});

test('if the panel boundaries cannot be worked out it still clicks the title and reveals the text (0.4.10 fail-open)', async () => {
  let header; let body;
  const page = loadContentScript((h) => {
    header = h('div', { class: 'q' }, [], "I'm not interested.");
    body = h('div', { class: 'a', 'data-display': 'none' }, [], 'Totally understand...');
    return [h('div', {}, [header, body])];
  });
  const result = await page.send(reveal); // no otherLabels, no Expand All
  assert.equal(result.found, true);
  assert.equal(header.clicks, 1);
  assert.equal(body.getClientRects().length, 1);
  assert.match(result.action, /^clicked-/);
});

test('the service worker reports which stage failed and never stores the transcript', () => {
  const { describeOutcome } = loadModule();
  const label = "I'm not interested";
  assert.deepEqual({ ...describeOutcome(null, label) }, { status: 'page-not-reachable', stage: 'talk-to-page', message: describeOutcome(null, label).message });
  assert.equal(describeOutcome({ ok: false, error: 'boom' }, label).stage, 'open-panel');
  assert.match(describeOutcome({ ok: false, error: 'boom' }, label).message, /boom/);
  assert.equal(describeOutcome({ ok: true, found: false }, label).status, 'rebuttal-not-found');
  assert.equal(describeOutcome({ ok: true, found: false }, label).stage, 'find-panel');
  const opened = describeOutcome({ ok: true, found: true, action: 'clicked-title-then-revealed' }, label);
  assert.equal(opened.status, 'opened');
  assert.equal(opened.stage, 'done');
  assert.equal(opened.action, 'clicked-title-then-revealed');
  assert.match(opened.message, /clicked its title and showed the hidden text/);

  const worker = fs.readFileSync(path.join(__dirname, '../extension/src/background/service-worker.js'), 'utf8');
  const handler = worker.slice(worker.indexOf('async function handleObjectionTranscript'), worker.indexOf('async function revealSalebaseRebuttal'));
  assert.match(handler, /try \{[\s\S]*objectionDetector\.detect[\s\S]*\} catch \(error\) \{[\s\S]*outcome: 'matcher-error'/);
  assert.match(handler, /'impact\.lastHeard': \{ at: Date\.now\(\), outcome: detection\.reason/);
  assert.match(handler, /'objection\.cooldown'/);
  assert.doesNotMatch(handler, /transcript[,}]\s*\}|text: transcript|lastTranscript/);
  assert.match(worker, /'impact\.lastObjection': \{ label: match\.label, at: Date\.now\(\), status: result\.status, stage: result\.stage/);
  assert.match(worker, /'salebase\.rebuttal', \{[\s\S]*stage: result\.stage[\s\S]*matchScore: match\.score/);

  const popup = fs.readFileSync(path.join(__dirname, '../extension/src/popup/popup.js'), 'utf8');
  for (const status of ['no-script-window', 'page-not-reachable', 'page-error', 'rebuttal-not-found', 'error']) {
    assert.match(popup, new RegExp(`'?${status}'?: 'Stopped at: `), status);
  }
  assert.match(popup, /changes\['impact\.lastHeard'\]/);
  assert.match(popup, /no objection matched/);
});

test('the lead-script opener re-uses Salebase windows and only tries to open one once per lead', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../extension/src/background/service-worker.js'), 'utf8');
  const opener = worker.slice(worker.indexOf('async function openMatchingSalebaseScript'), worker.indexOf('async function clickSalebaseCallLink'));
  assert.match(opener, /findSalebaseScriptTabs\(chrome\)/);
  assert.match(opener, /if \(openKey === lastSalebaseOpenKey\) return;/);
  assert.match(worker, /openMatchingSalebaseScript\(lead\.requestType, lead\.leadId \|\| lead\.leadName \|\| ''\)/);
  const fallback = worker.slice(worker.indexOf('async function openSalebaseFallback'), worker.indexOf('async function selectSalebaseScript'));
  assert.match(fallback, /filter\(\(tab\) => !before\.has\(tab\.id\)\)/);
});
