const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadModule() {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/background/salebase-rebuttal.js'), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({ URL, setTimeout, console, Promise });
  vm.runInContext(`${source}\nthis.api = { salebaseUrlInfo, isSalebaseScriptUrl, rankScriptTabs, chooseScriptTab, revealRebuttalInScriptTab, SALEBASE_TAB_QUERY, REBUTTAL_CONTENT_SCRIPT };`, context);
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
    URL, console, setTimeout: () => 0, document,
    location: { href: SCRIPT_URL },
    chrome: { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } },
    addEventListener: (_type, fn) => win.listeners.add(fn),
    removeEventListener: (_type, fn) => win.listeners.delete(fn)
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/src/content/salebase-rebuttal.js'), 'utf8'), context);
  const send = (message) => { let response; listener(message, {}, (value) => { response = value; }); return response; };
  return { send, win, byId: document.getElementById };
}

const reveal = { type: 'impact/revealRebuttal', label: MATCH.label, phrases: MATCH.phrases };

test('a collapsed in-page panel is opened by its own toggle without navigating', () => {
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
  assert.deepEqual({ ...page.send({ type: 'impact/probeRebuttal', label: MATCH.label, phrases: MATCH.phrases }) }, { ok: true, isScriptPage: true, hasRebuttal: true, matchKind: 'label-exact' });
  const result = page.send(reveal);
  assert.equal(result.found, true);
  assert.equal(result.action, 'clicked-toggle');
  assert.equal(result.bodyShown, true);
  assert.equal(result.forcedVisible, false);
  assert.equal(toggle.clicks, 1);
  assert.ok(toggle.scrolled);
  assert.deepEqual(page.win.navigations, []);
  // Hearing the same objection again must not collapse the open panel.
  const again = page.send(reveal);
  assert.equal(again.action, 'already-open');
  assert.equal(toggle.clicks, 1);
});

test('a link that would open a new Salebase tab is never clicked; the in-page panel is used instead', () => {
  let link; let header; let body;
  const page = loadContentScript((h) => {
    link = h('a', { href: '/phone_scripts/rebuttal.php?id=3', target: '_blank' }, [], "I'm not interested");
    header = h('div', { class: 'rebuttal-header', onclick: 'toggleRebuttal(this)' }, [], "I'm not interested");
    body = h('div', { class: 'rebuttal-body', 'data-display': 'none' }, [], 'Totally fair...');
    header.onClick = () => { body.style.display = 'block'; };
    return [h('nav', {}, [link]), h('div', { class: 'rebuttals' }, [header, body])];
  });
  const result = page.send(reveal);
  assert.equal(result.action, 'clicked-toggle');
  assert.equal(result.header.classes, 'rebuttal-header');
  assert.equal(link.clicks, 0);
  assert.equal(header.clicks, 1);
  assert.equal(result.bodyShown, true);
  assert.deepEqual(page.win.navigations, []);
});

test('when the only match is a navigating link, the panel is revealed in place and the link is left alone', () => {
  let link; let body;
  const page = loadContentScript((h) => {
    link = h('a', { href: 'https://salebase.ai/phone_scripts/phone_scripts.php?rebuttal=2', target: '_blank', onclick: "window.open(this.href); return false;" }, [], "I'm not interested");
    body = h('div', { class: 'answer', hidden: '' }, [], 'Most people feel that way...');
    return [h('div', { class: 'item' }, [link, body])];
  });
  const result = page.send(reveal);
  assert.equal(result.found, true);
  assert.equal(result.action, 'skipped-navigating-link');
  assert.match(result.skippedLink.reason, /onclick opens|target=_blank/);
  assert.equal(result.skippedLink.href.includes('?'), false, 'query strings are not logged');
  assert.equal(link.clicks, 0);
  assert.equal(result.forcedVisible, true);
  assert.equal(body.getClientRects().length, 1);
  assert.deepEqual(page.win.navigations, []);
});

test('a click that bubbles into a navigating link is prevented', () => {
  let span;
  const page = loadContentScript((h) => {
    span = h('span', { role: 'button' }, [], "I'm not interested");
    return [h('a', { href: '/other.php', target: '_blank' }, [span])];
  });
  const result = page.send(reveal);
  assert.equal(result.action, 'skipped-navigating-link');
  assert.equal(span.clicks, 0);
  assert.deepEqual(page.win.navigations, []);
});

test('details/summary rebuttals are opened and missing rebuttals are reported with debug info', () => {
  let details;
  const page = loadContentScript((h) => {
    details = h('details', {}, [h('summary', {}, [], 'Can you mail it to me?'), h('p', {}, [], 'Sure, but...')]);
    return [details];
  });
  const opened = page.send({ type: 'impact/revealRebuttal', label: 'Can you mail it to me?', phrases: ['mail it to me'] });
  assert.equal(opened.action, 'opened-details');
  assert.equal(details.open, true);
  const missing = page.send({ type: 'impact/revealRebuttal', label: 'Do we have to do a Zoom meeting?', phrases: ['zoom meeting'] });
  assert.equal(missing.found, false);
  assert.equal(missing.candidates, 0);
  assert.equal(missing.isScriptPage, false);
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
