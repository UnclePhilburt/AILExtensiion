// Calm script view for the Salebase phone script page.
// Draws a quiet, phone-app-style reading view (lead header, script picker,
// large script column, searchable rebuttal cards) in a shadow root on top of
// the page. The real Salebase page stays in the DOM, laid out and untouched
// underneath: the picker sets #myDropdown, buttons in the view click the real
// buttons, and the view re-reads the page whenever it changes. So rebuttal
// opening, lead fills, script switching and the element picker keep working
// exactly as before. If the page can't be read, the view simply isn't shown.
(() => {
  const STOP_EVENT = 'impact-calm-view-stop';
  document.dispatchEvent(new Event(STOP_EVENT));

  const HOST_ID = 'impact-calm-host';
  const SETTING_KEY = 'impact.calmScripts';
  const SIZE_KEY = 'impact.calmScriptSize';
  const PICKER_OUTLINE_ID = 'impact-companion-picker-outline';
  const GIVE_UP_AFTER_MS = 8000;
  const RENDER_DELAY_MS = 120;
  const OBJECTION_FRESH_MS = 90 * 1000;
  const SIZES = [16, 17.5, 19, 21, 23.5];
  const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|OBJECT|EMBED|LINK|META|SVG|CANVAS|VIDEO|AUDIO)$/;
  const CLICKABLE = 'button, a, input, label, select, summary, [onclick], [role="button"], [data-target]';

  const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
  const compact = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const words = (text) => String(text || '').toLowerCase().match(/[a-z0-9']+/g) || [];
  const hasClass = (element, name) => Boolean(name) && Boolean(element?.classList?.contains(name));

  // ---- Reading the real page ------------------------------------------------
  function isHidden(element) {
    try {
      const style = getComputedStyle(element);
      return style.display === 'none' || style.visibility === 'hidden';
    } catch (_error) { return false; }
  }
  // Laid out on the page (the view covers the page but never hides it).
  function isShown(element) {
    return Boolean(element && element.getClientRects().length > 0 && !isHidden(element));
  }
  const pickShown = (list, value) => {
    const matching = list.filter((element) => hasClass(element, value));
    return matching.find(isShown) || list.find(isShown) || matching[0] || null;
  };

  // Text of a rebuttal title without its answer (the answer can sit inside it).
  function titleText(element) {
    if (!element) return '';
    const copy = element.cloneNode(true);
    copy.querySelectorAll('.rebuttal-answer, script, style').forEach((node) => node.remove());
    return clean(copy.textContent);
  }

  function isOpenRebuttal(item, answer) {
    if (hasClass(item, 'collapsed')) return false;
    return answer ? isShown(answer) : !hasClass(item, 'collapsed');
  }

  // Salebase writes <p class="rebuttal-item"><span class="ConditionalChar">Title</span><div class="rebuttal-answer">…</div></p>.
  // Parsed from HTML the <div> closes the <p>, so the answer can also be the next sibling.
  function parseRebuttals(group) {
    if (!group) return [];
    const seen = new Map();
    return [...group.querySelectorAll('.rebuttal-item')].map((item) => {
      let answer = item.querySelector('.rebuttal-answer');
      if (!answer && hasClass(item.nextElementSibling, 'rebuttal-answer')) answer = item.nextElementSibling;
      const titleElement = item.querySelector('.ConditionalChar') || item;
      const title = titleText(titleElement);
      const base = compact(title);
      const count = (seen.get(base) || 0) + 1;
      seen.set(base, count);
      return { key: count > 1 ? `${base}~${count}` : base, title, item, answer, open: isOpenRebuttal(item, answer) };
    }).filter((rebuttal) => rebuttal.title);
  }

  function parsePage(doc = document) {
    const fail = (reason, detail) => ({ ok: false, reason, detail });
    const dropdown = doc.getElementById('myDropdown');
    if (!dropdown || dropdown.tagName !== 'SELECT') return fail('no-dropdown', 'No #myDropdown select on the page.');
    const options = [...dropdown.options].map((option) => ({ value: option.value, label: clean(option.textContent) || option.value })).filter((option) => option.value);
    if (!options.length) return fail('no-options', '#myDropdown has no script options.');
    const value = dropdown.value;
    const rebuttalColumn = doc.getElementById('rebuttalsColumn') || doc.getElementById('expandAllRebuttals')?.closest('.right-column') || null;
    const scriptRoot = dropdown.closest('.left-column') || dropdown.closest('.container') || doc.body;
    const blocks = [...scriptRoot.querySelectorAll('.script-type')].filter((element) => !rebuttalColumn?.contains(element) && !element.parentElement?.closest('.script-type'));
    if (!blocks.length) return fail('no-script-blocks', 'No .script-type blocks next to #myDropdown.');
    const script = pickShown(blocks, value);
    if (!script) return fail('no-script', `No script block for "${value}".`);
    if (clean(script.textContent).length < 20) return fail('empty-script', `The "${value}" script block has no text.`);
    const groups = rebuttalColumn ? [...rebuttalColumn.querySelectorAll('.script-type')] : [];
    const rebuttalGroup = groups.length ? pickShown(groups, value) : null;
    const single = doc.getElementById('singleCheckbox');
    return {
      ok: true, dropdown, options, value, script, rebuttalColumn, rebuttalGroup,
      rebuttals: parseRebuttals(rebuttalGroup),
      single, singleToggle: single ? (single.closest('label') || single) : null,
      callPill: doc.getElementById('callCountPill'), callMinus: doc.getElementById('ccMinus'), callPlus: doc.getElementById('ccPlus'),
      detailsButton: doc.getElementById('settingsButton')
    };
  }

  // Best rebuttal for a listener label ("Can you mail it to me?").
  function matchRebuttal(rebuttals, label) {
    const target = compact(label);
    if (!target) return null;
    const exact = rebuttals.find((rebuttal) => compact(rebuttal.title) === target);
    if (exact) return exact;
    const partial = rebuttals.find((rebuttal) => { const title = compact(rebuttal.title); return title.length >= 6 && (title.includes(target) || target.includes(title)); });
    if (partial) return partial;
    const want = new Set(words(label).filter((word) => word.length > 2));
    let best = null; let bestScore = 0;
    for (const rebuttal of rebuttals) {
      const have = new Set(words(rebuttal.title));
      const shared = [...want].filter((word) => have.has(word)).length;
      const score = want.size ? shared / want.size : 0;
      if (score > bestScore) { best = rebuttal; bestScore = score; }
    }
    return bestScore >= 0.6 ? best : null;
  }

  // ---- Copying what is visible into the view ---------------------------------
  // Only what the rep can see on the real page is copied (hidden responses,
  // couple/single variants and sections stay out). Clickable things remember
  // their original so a click in the view clicks the real one.
  let originals = new WeakMap();
  function copyVisible(node, skip) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.test(node.tagName.toUpperCase()) || isHidden(node) || skip?.(node)) return null;
    const tag = node.tagName.toLowerCase();
    const copy = document.createElement(tag === 'a' ? 'span' : tag);
    const className = node.getAttribute('class');
    if (className) copy.setAttribute('class', className);
    for (const name of ['data-impact-fill', 'data-target', 'title', 'colspan', 'rowspan']) {
      if (node.hasAttribute(name)) copy.setAttribute(name, node.getAttribute(name));
    }
    if (tag === 'input') {
      copy.setAttribute('type', node.getAttribute('type') || 'text');
      if (node.checked) copy.setAttribute('checked', '');
      if (node.value && node.type !== 'checkbox' && node.type !== 'radio') copy.setAttribute('value', node.value);
      copy.setAttribute('tabindex', '-1');
    }
    if (tag === 'button') copy.setAttribute('type', 'button');
    if (node.matches(CLICKABLE)) {
      copy.setAttribute('data-calm-proxy', '');
      if (tag === 'a') { copy.setAttribute('role', 'button'); copy.setAttribute('tabindex', '0'); copy.classList.add('calm-link'); }
      originals.set(copy, node);
    }
    for (const child of node.childNodes) {
      const childCopy = copyVisible(child, skip);
      if (childCopy) copy.append(childCopy);
    }
    return copy;
  }
  function copyChildren(element, skip) {
    const fragment = document.createDocumentFragment();
    if (!element) return fragment;
    for (const child of element.childNodes) {
      const copy = copyVisible(child, skip);
      if (copy) fragment.append(copy);
    }
    return fragment;
  }
  // "(Member)" still showing because the lead has no value for it.
  function markMissing(container) {
    container.querySelectorAll('[class*="Output"]').forEach((node) => {
      if (!node.querySelector('[data-impact-fill]') && /^[([{].{1,40}[)\]}]$/.test(clean(node.textContent))) node.classList.add('calm-missing');
    });
    return container;
  }
  const isBackToScript = (node) => hasClass(node, 'smallfont') && /^\(?back to script\)?$/i.test(clean(node.textContent));

  // ---- The view -------------------------------------------------------------
  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.app { position: fixed; inset: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); background: #eff3f1; color: #203536; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; pointer-events: auto; }
button { font: inherit; cursor: pointer; }
.band { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 22px; padding: 16px 24px 18px; color: #fff; background-color: #123b3a; background-image: radial-gradient(70% 140% at 8% 0%, #1f5d54 0%, #1f5d5400 70%), radial-gradient(60% 120% at 100% 100%, #0c2f2f 0%, #0c2f2f00 72%); }
.who { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1 1 320px; }
.mark { flex: none; width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center; background: #ffffff1a; }
.mark svg { width: 22px; height: 22px; }
.eyebrow { margin: 0 0 3px; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #9fd3c2; }
.leadName { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -.01em; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.leadName.none { color: #cfe3dc; font-weight: 600; font-size: 20px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.chip { padding: 3px 10px; border-radius: 999px; background: #ffffff1c; color: #e3f2ec; font-size: 12.5px; font-weight: 600; }
.chip.group { background: #f3c96b2e; color: #ffe6a8; }
.tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tool { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: #ffffff17; color: #eaf5f0; font-size: 13px; font-weight: 600; }
.tool:hover { background: #ffffff26; }
.tool.primary { background: #fff; color: #174a3d; }
.tool.primary:hover { background: #e9f4ef; }
.switch { width: 32px; height: 19px; border-radius: 999px; background: #ffffff38; position: relative; transition: background .15s; }
.switch::after { content: ""; position: absolute; top: 2.5px; left: 2.5px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s; }
.tool[aria-pressed="true"] .switch { background: #3fb58a; }
.tool[aria-pressed="true"] .switch::after { transform: translateX(13px); }
.counter { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; background: #ffffff17; font-size: 13px; font-weight: 600; color: #eaf5f0; }
.counter span { padding: 0 8px; white-space: nowrap; }
.counter button { width: 30px; height: 30px; border: 0; border-radius: 50%; background: #ffffff1c; color: #fff; font-size: 16px; line-height: 1; }
.counter button:hover { background: #ffffff33; }
.size { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: #ffffff17; }
.size button { width: 32px; height: 30px; border: 0; border-radius: 999px; background: transparent; color: #eaf5f0; font-weight: 700; }
.size button:hover { background: #ffffff26; }
.main { display: grid; grid-template-columns: 220px minmax(0, 1fr) minmax(300px, 380px); gap: 18px; padding: 18px; min-height: 0; }
.card { border-radius: 24px; background: #fff; box-shadow: 0 1px 2px #0b1f1c0f, 0 14px 34px #0b1f1c17; }
.scripts { padding: 16px 10px; overflow: auto; overscroll-behavior: contain; align-self: start; max-height: 100%; }
.scripts .eyebrow { color: #547368; padding: 0 10px 8px; }
.scripts nav { display: grid; gap: 3px; }
.scripts button { display: block; width: 100%; padding: 10px 12px; border: 0; border-radius: 14px; background: transparent; color: #2d4a45; font-size: 14.5px; font-weight: 600; text-align: left; }
.scripts button:hover { background: #eef5f1; }
.scripts button[aria-current="true"] { background: linear-gradient(135deg, #247456, #1d6a4e); color: #fff; box-shadow: 0 6px 16px #17684e2e; }
.reading { overflow: auto; overscroll-behavior: contain; padding: 34px 40px 60px; scroll-behavior: smooth; }
.readHead { max-width: 70ch; font-size: var(--calm-size, 19px); margin: 0 auto 18px; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.readHead h1 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #547368; }
.readHead .hint { font-size: 12.5px; color: #7b918a; }
.read { max-width: 70ch; margin: 0 auto; font-size: var(--calm-size, 19px); line-height: 1.72; color: #1f3431; overflow-wrap: break-word; }
.read p { margin: .55em 0; }
.read p:empty { display: none; }
.read .phone-step { display: block; margin: 1.9em 0 .55em; font-size: 12px; line-height: 1.4; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: #247456; }
.read .phone-step::before { content: ""; display: inline-block; width: 7px; height: 7px; margin: 0 9px 1px 0; border-radius: 50%; background: #3fb58a; vertical-align: middle; }
.read > .phone-step:first-child { margin-top: 0; }
.read .phone-step + br { display: none; }
.read .VERBALChar { font-weight: 600; color: #143c35; }
.read .TECHNICALChar, .rb .TECHNICALChar { display: inline; padding: .1em .55em; border-radius: 8px; background: #fbf4e4; color: #7a5518; font-style: italic; font-size: .88em; font-weight: 500; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.read .ConditionalChar { color: #3d5f7a; font-style: italic; }
.read .smallfont, .rb .smallfont { font-size: .8em; color: #7b918a; }
[data-impact-fill] { font-weight: 700 !important; color: #0e3f37 !important; background: #0d94880f; border-radius: 4px; text-decoration: underline !important; text-decoration-color: rgba(13,148,136,.55) !important; text-decoration-thickness: 2px !important; text-underline-offset: 3px !important; }
.calm-missing { padding: 0 .3em; border-radius: 6px; background: #fff3e2; color: #8a4b12; font-weight: 600; }
.read .button-response-container { margin: 1em 0; padding: 14px 16px; border-radius: 18px; background: #f4f8f6; }
.read .button-container { display: flex; flex-wrap: wrap; gap: 8px; }
.read button, .read .calm-link { display: inline-flex; align-items: center; min-height: 34px; padding: 0 15px; border: 0; border-radius: 999px; background: #e4f1ea; color: #1f5a47; font-size: 14px; font-weight: 700; line-height: 1.2; cursor: pointer; }
.read button:hover, .read .calm-link:hover { background: #d4eadf; }
.read .calm-link { min-height: 0; padding: 1px 10px; font-size: .8em; }
.read .response-container:not(:empty) { margin-top: 4px; }
.read .response { display: block; margin-top: 10px; padding: 12px 16px; border-radius: 14px; background: #fff; box-shadow: inset 3px 0 0 #3fb58a, 0 1px 2px #0b1f1c0f; }
.read ul, .read ol { padding-left: 1.3em; }
.read li { margin: .3em 0; }
.read strong, .read b { font-weight: 700; }
.side { display: grid; grid-template-rows: auto auto minmax(0, 1fr); min-height: 0; padding: 18px 16px 8px; }
.sideHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px 10px; }
.sideHead h2 { margin: 0; font-size: 18px; font-weight: 700; color: #183a34; }
.sideHead .count { margin-left: 6px; font-size: 13px; font-weight: 600; color: #7b918a; }
.textButtons { display: flex; gap: 2px; }
.textButtons button { padding: 5px 9px; border: 0; border-radius: 999px; background: transparent; color: #356b50; font-size: 12.5px; font-weight: 700; }
.textButtons button:hover { background: #eef5f1; }
.search { position: relative; margin: 0 0 12px; }
.search svg { position: absolute; left: 13px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); color: #7b918a; }
.search input { width: 100%; height: 40px; padding: 0 14px 0 38px; border: 0; border-radius: 999px; background: #f1f6f3; color: #203536; font: inherit; font-size: 14.5px; outline: none; }
.search input:focus { background: #e9f3ee; box-shadow: 0 0 0 3px #3fb58a33; }
.list { position: relative; overflow: auto; overscroll-behavior: contain; display: grid; align-content: start; gap: 8px; padding: 2px 2px 16px; }
.heard { position: sticky; top: 0; z-index: 1; margin-bottom: 4px; padding: 14px 16px; border-radius: 18px; background: linear-gradient(135deg, #fff4eb, #ffe9dc); color: #8a3d17; box-shadow: 0 3px 10px #c2622a17; }
.heard .eyebrow { color: #b0612f; }
.heard .label { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; font-size: 16.5px; font-weight: 700; line-height: 1.35; color: #6f2f10; }
.heard .label button { flex: none; width: 26px; height: 26px; border: 0; border-radius: 50%; background: #ffffff8c; color: #8a3d17; font-size: 15px; line-height: 1; }
.heard .status { margin-top: 5px; font-size: 12.5px; color: #9a5a33; }
.rb { border-radius: 16px; background: #f5f8f6; transition: background .2s, box-shadow .2s; }
.rb > button { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 12px 14px; border: 0; border-radius: 16px; background: transparent; color: #1f3a35; font-size: 14.5px; font-weight: 650; line-height: 1.4; text-align: left; }
.rb > button:hover { background: #edf4f0; }
.chev { flex: none; width: 16px; height: 16px; margin-top: 2px; color: #3f8a6d; transition: transform .18s; }
.rb.open > button .chev { transform: rotate(90deg); }
.rb .body { display: none; padding: 0 16px 14px 40px; font-size: 15px; line-height: 1.62; color: #2a403c; }
.rb.open .body { display: block; }
.rb .body p { margin: .45em 0; }
.rb .VERBALChar { font-weight: 600; color: #143c35; }
.rb.hit { background: #fff7e8; box-shadow: 0 0 0 2px #f2b84b80, 0 8px 22px #c2862a1f; }
.empty { padding: 18px 8px; color: #7b918a; font-size: 13.5px; line-height: 1.5; text-align: center; }
.pill { position: fixed; right: 18px; bottom: 18px; display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 18px; border: 0; border-radius: 999px; background: linear-gradient(135deg, #1c7658, #145c45); color: #fff; font: 600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 8px 20px #17684e45; pointer-events: auto; cursor: pointer; }
.pill:hover { filter: brightness(1.08); }
@media (max-width: 1180px) { .main { grid-template-columns: minmax(0, 1fr) minmax(280px, 340px); grid-template-rows: auto minmax(0, 1fr); } .scripts { grid-column: 1 / -1; padding: 8px; max-height: none; } .scripts .eyebrow { display: none; } .scripts nav { display: flex; overflow-x: auto; gap: 4px; } .scripts button { width: auto; white-space: nowrap; } .reading { padding: 28px 28px 60px; } }
@media (max-width: 780px) { .app { overflow: auto; } .main { display: block; } .main > * { margin-bottom: 14px; } .reading, .list { overflow: visible; } .band { padding: 14px 16px; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; scroll-behavior: auto !important; } }
`;

  const ICON_CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
  const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const ICON_MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="#bfe6d8" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M4 10h16M4 15h10M4 20h7"/></svg>';

  let host = null; let root = null; let ui = null;
  let enabled = true; let settingKnown = false;
  let showOriginal = false; let pickerActive = false; let stopped = false;
  let lastGood = null; let lastValue = null; let lastOpen = null;
  let lead = null; let objection = null; let sizeStep = 2;
  let search = ''; const openCards = new Set(); let hitKey = ''; let hitTimer = 0;
  let scriptSignature = ''; let rebuttalSignature = '';
  let renderTimer = 0; const startedAt = Date.now(); let gaveUpLogged = ''; let fallbackReason = '';

  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  };

  function log(level, event, details) {
    try { chrome.runtime.sendMessage({ type: 'impact/log', entry: { level, event, details, url: location.origin + location.pathname } }).catch(() => {}); } catch (_error) { /* extension reloaded */ }
  }

  function ensureHost() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-impact-ui', 'calm-script');
    host.setAttribute('translate', 'no');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483600;pointer-events:none;';
    root = host.attachShadow({ mode: 'open' });
    root.append(el('style', { text: CSS }));
    buildApp();
    document.documentElement.append(host);
    scriptSignature = ''; rebuttalSignature = '';
  }

  function removeHost() {
    host?.remove();
    host = null; root = null; ui = null;
  }

  function buildApp() {
    ui = {};
    ui.leadName = el('p', { class: 'leadName' });
    ui.chips = el('div', { class: 'chips' });
    ui.single = el('button', { class: 'tool', type: 'button', 'aria-pressed': 'false', title: 'Salebase SINGLE toggle', onclick: () => clickOriginal(lastGood?.singleToggle) }, [el('span', { class: 'switch' }), el('span', { text: 'Single' })]);
    ui.callCount = el('span', { text: '' });
    ui.counter = el('div', { class: 'counter', title: 'Calls made today (Salebase counter)' }, [
      el('button', { type: 'button', 'aria-label': 'Remove call', text: '−', onclick: () => clickOriginal(lastGood?.callMinus) }),
      ui.callCount,
      el('button', { type: 'button', 'aria-label': 'Add call', text: '+', onclick: () => clickOriginal(lastGood?.callPlus) })
    ]);
    ui.details = el('button', { class: 'tool', type: 'button', text: 'Client details', title: 'Opens Salebase client details on the original page', onclick: () => { const button = lastGood?.detailsButton; setShowOriginal(true); clickOriginal(button); } });
    const size = el('div', { class: 'size', title: 'Text size' }, [
      el('button', { type: 'button', 'aria-label': 'Smaller text', text: 'A−', onclick: () => setSize(sizeStep - 1) }),
      el('button', { type: 'button', 'aria-label': 'Larger text', text: 'A+', onclick: () => setSize(sizeStep + 1) })
    ]);
    const original = el('button', { class: 'tool primary', type: 'button', text: 'Original page', title: 'Show the original Salebase page', onclick: () => setShowOriginal(true) });
    const band = el('header', { class: 'band' }, [
      el('div', { class: 'who' }, [el('div', { class: 'mark', html: ICON_MARK }), el('div', {}, [el('p', { class: 'eyebrow', text: 'Calm script' }), ui.leadName, ui.chips])]),
      el('div', { class: 'tools' }, [ui.single, ui.counter, ui.details, size, original])
    ]);

    ui.nav = el('nav', { 'aria-label': 'Scripts' });
    const scripts = el('aside', { class: 'card scripts' }, [el('p', { class: 'eyebrow', text: 'Scripts' }), ui.nav]);
    ui.nav.addEventListener('click', (event) => { const button = event.target.closest('button[data-value]'); if (button) chooseScript(button.dataset.value); });

    ui.readTitle = el('h1');
    ui.read = el('div', { class: 'read' });
    ui.read.addEventListener('click', proxyClick);
    ui.read.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target.closest?.('.calm-link')) proxyClick(event); });
    ui.reading = el('main', { class: 'card reading' }, [el('div', { class: 'readHead' }, [ui.readTitle, el('span', { class: 'hint', text: 'Teal underline = from the IMPACT lead' })]), ui.read]);

    ui.count = el('span', { class: 'count' });
    ui.searchInput = el('input', { type: 'search', placeholder: 'Search rebuttals', 'aria-label': 'Search rebuttals', oninput: (event) => { search = event.target.value; renderRebuttals(true); } });
    ui.list = el('div', { class: 'list' });
    ui.heard = el('div', { class: 'heard', hidden: '' });
    const side = el('aside', { class: 'card side' }, [
      el('div', { class: 'sideHead' }, [el('h2', {}, [document.createTextNode('Rebuttals'), ui.count]), el('div', { class: 'textButtons' }, [
        el('button', { type: 'button', text: 'Expand all', onclick: () => { currentRebuttals().forEach((rebuttal) => openCards.add(cardKey(rebuttal))); renderRebuttals(true); } }),
        el('button', { type: 'button', text: 'Collapse all', onclick: () => { openCards.clear(); renderRebuttals(true); } })
      ])]),
      el('label', { class: 'search', html: ICON_SEARCH }, [ui.searchInput]),
      ui.list
    ]);
    ui.list.addEventListener('click', (event) => {
      const button = event.target.closest('.rb > button');
      if (!button) return;
      const key = button.parentElement.dataset.key;
      if (openCards.has(key)) openCards.delete(key); else openCards.add(key);
      button.parentElement.classList.toggle('open', openCards.has(key));
      button.setAttribute('aria-expanded', String(openCards.has(key)));
    });

    ui.app = el('div', { class: 'app' }, [band, el('div', { class: 'main' }, [scripts, ui.reading, side])]);
    ui.pill = el('button', { class: 'pill', type: 'button', hidden: '', onclick: () => setShowOriginal(false) }, [el('span', { html: ICON_MARK.replace('#bfe6d8', '#ffffff').replace('<svg', '<svg width="18" height="18"') }), el('span', { text: 'Calm view' })]);
    // Keys and clicks in the view stay in the view: Salebase's own page
    // shortcuts never see typing in the rebuttal search.
    for (const type of ['keydown', 'keyup', 'keypress', 'click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
      ui.app.addEventListener(type, (event) => event.stopPropagation());
    }
    root.append(ui.app, ui.pill);
    applySize();
  }

  // ---- Actions (all drive the real page) -------------------------------------
  function clickOriginal(element) {
    if (!element?.isConnected) return false;
    element.click();
    scheduleRender(30);
    return true;
  }

  function proxyClick(event) {
    const copy = event.target.closest?.('[data-calm-proxy]');
    if (!copy || !ui.read.contains(copy)) return;
    event.preventDefault();
    const original = originals.get(copy);
    if (!clickOriginal(original)) { scriptSignature = ''; scheduleRender(0); }
  }

  function chooseScript(value) {
    const dropdown = document.getElementById('myDropdown');
    if (!dropdown || dropdown.value === value) return;
    dropdown.value = value;
    dropdown.dispatchEvent(new Event('input', { bubbles: true }));
    dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    scheduleRender(0);
  }

  function setShowOriginal(value) {
    showOriginal = value;
    update();
  }

  function setSize(step) {
    sizeStep = Math.max(0, Math.min(SIZES.length - 1, step));
    applySize();
    try { void chrome.storage.local.set({ [SIZE_KEY]: sizeStep }).catch(() => {}); } catch (_error) { /* ignore */ }
  }
  function applySize() { ui?.app.style.setProperty('--calm-size', `${SIZES[sizeStep]}px`); }

  // ---- Rendering --------------------------------------------------------------
  function renderHeader(page) {
    const name = clean(lead?.fullName || [lead?.firstName, lead?.lastName].filter(Boolean).join(' '));
    ui.leadName.textContent = name || 'No lead loaded';
    ui.leadName.classList.toggle('none', !name);
    const current = page.options.find((option) => option.value === page.value);
    const chips = [];
    const group = clean(lead?.group);
    if (group) chips.push(['chip group', group]);
    if (clean(lead?.requestType)) chips.push(['chip', clean(lead.requestType)]);
    if (current && compact(current.label) !== compact(lead?.requestType)) chips.push(['chip', current.label]);
    const signature = JSON.stringify(chips);
    if (ui.chips.dataset.signature !== signature) {
      ui.chips.replaceChildren(...chips.map(([className, text]) => el('span', { class: className, text })));
      ui.chips.dataset.signature = signature;
    }
    ui.single.hidden = !page.singleToggle;
    ui.single.setAttribute('aria-pressed', String(Boolean(page.single?.checked)));
    ui.counter.hidden = !page.callPill;
    if (page.callPill) ui.callCount.textContent = `${clean(page.callPill.textContent) || '0'} today`;
    ui.details.hidden = !page.detailsButton;
  }

  function renderNav(page) {
    const signature = JSON.stringify([page.options, page.value]);
    if (ui.nav.dataset.signature === signature) return;
    ui.nav.dataset.signature = signature;
    ui.nav.replaceChildren(...page.options.map((option) => el('button', { type: 'button', 'data-value': option.value, 'aria-current': String(option.value === page.value), text: option.label })));
  }

  function renderScript(page) {
    const current = page.options.find((option) => option.value === page.value);
    ui.readTitle.textContent = current?.label || page.value;
    const nextMap = new WeakMap();
    const previous = originals; originals = nextMap;
    const fragment = copyChildren(page.script);
    const holder = document.createElement('div');
    holder.append(fragment);
    markMissing(holder);
    const signature = page.value + '|' + holder.innerHTML;
    if (signature === scriptSignature) { originals = previous; return; }
    scriptSignature = signature;
    const changedScript = ui.read.dataset.value !== page.value;
    ui.read.dataset.value = page.value;
    ui.read.replaceChildren(...holder.childNodes);
    if (changedScript) ui.reading.scrollTop = 0;
  }

  const currentRebuttals = () => lastGood?.rebuttals || [];
  const cardKey = (rebuttal) => `${lastGood?.value || ''}:${rebuttal.key}`;

  function renderRebuttals(force = false) {
    const rebuttals = currentRebuttals();
    const query = words(search);
    const shown = rebuttals.filter((rebuttal) => {
      if (!query.length) return true;
      const text = `${rebuttal.title} ${rebuttal.answer?.textContent || ''}`.toLowerCase();
      return query.every((word) => text.includes(word));
    });
    const bodies = shown.map((rebuttal) => { const holder = document.createElement('div'); holder.append(copyChildren(rebuttal.answer, isBackToScript)); return markMissing(holder); });
    const signature = JSON.stringify([lastGood?.value, search, hitKey, [...openCards], shown.map((rebuttal) => rebuttal.key)]) + bodies.map((body) => body.innerHTML).join('|');
    if (!force && signature === rebuttalSignature) return;
    rebuttalSignature = signature;
    ui.count.textContent = rebuttals.length ? String(rebuttals.length) : '';
    const cards = shown.map((rebuttal, index) => {
      const key = cardKey(rebuttal);
      const isOpen = openCards.has(key);
      const body = bodies[index]; body.className = 'body';
      if (!clean(body.textContent)) body.textContent = 'Open the original page to read this rebuttal.';
      return el('div', { class: `rb${isOpen ? ' open' : ''}${key === hitKey ? ' hit' : ''}`, 'data-key': key }, [
        el('button', { type: 'button', 'aria-expanded': String(isOpen), html: ICON_CHEV }, [el('span', { text: rebuttal.title })]),
        body
      ]);
    });
    if (!cards.length) cards.push(el('p', { class: 'empty', text: rebuttals.length ? 'No rebuttal matches your search.' : 'No rebuttals for this script.' }));
    const keepScroll = ui.list.scrollTop;
    ui.list.replaceChildren(ui.heard, ...cards);
    ui.list.scrollTop = keepScroll;
  }

  function renderHeard() {
    const fresh = objection && Date.now() - (objection.at || 0) < 10 * 60 * 1000 && !objection.dismissed;
    ui.heard.hidden = !fresh;
    if (!fresh) return;
    const statusText = objection.status === 'looking' ? 'Finding the rebuttal…'
      : objection.status === 'opened' ? 'Opened below (and on the Salebase page)'
        : clean(objection.message) || 'Rebuttal not opened';
    ui.heard.replaceChildren(
      el('p', { class: 'eyebrow', text: 'Objection just heard' }),
      el('div', { class: 'label' }, [el('span', { text: objection.label || 'Objection' }), el('button', { type: 'button', 'aria-label': 'Dismiss', text: '×', onclick: () => { objection.dismissed = true; renderHeard(); } })]),
      el('p', { class: 'status', text: statusText })
    );
  }

  function focusCard(rebuttal) {
    if (!rebuttal || !ui) return;
    const key = cardKey(rebuttal);
    openCards.add(key);
    hitKey = key;
    if (search && !matchesSearch(rebuttal)) { search = ''; ui.searchInput.value = ''; }
    renderRebuttals(true);
    const card = [...ui.list.querySelectorAll('.rb')].find((node) => node.dataset.key === key);
    // Keep the card just below the sticky "Objection just heard" card.
    if (card) ui.list.scrollTop = Math.max(0, card.offsetTop - (ui.heard.hidden ? 8 : ui.heard.offsetHeight + 12));
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => { hitKey = ''; renderRebuttals(true); }, 6000);
  }
  const matchesSearch = (rebuttal) => words(search).every((word) => `${rebuttal.title} ${rebuttal.answer?.textContent || ''}`.toLowerCase().includes(word));

  // ---- Deciding what to show ---------------------------------------------------
  const wanted = () => settingKnown && enabled && !stopped;

  function update() {
    renderTimer = 0;
    if (!wanted()) { removeHost(); return; }
    if (pickerActive) { if (host) host.style.display = 'none'; return; }
    const page = parsePage();
    if (!page.ok) { fallBack(page); return; }
    fallbackReason = '';
    // Rebuttals the service worker (or anyone) just opened on the real page.
    const openNow = new Set(page.rebuttals.filter((rebuttal) => rebuttal.open).map((rebuttal) => rebuttal.key));
    const newlyOpened = lastOpen && lastValue === page.value ? page.rebuttals.filter((rebuttal) => rebuttal.open && !lastOpen.has(rebuttal.key)) : [];
    if (lastValue !== page.value) { openCards.clear(); hitKey = ''; }
    lastOpen = openNow; lastValue = page.value; lastGood = page;
    ensureHost();
    host.style.display = '';
    ui.app.hidden = showOriginal;
    ui.pill.hidden = !showOriginal;
    host.style.pointerEvents = 'none';
    if (showOriginal) return;
    renderHeader(page);
    renderNav(page);
    renderScript(page);
    renderRebuttals();
    renderHeard();
    if (newlyOpened.length) focusCard(newlyOpened[newlyOpened.length - 1]);
  }

  function fallBack(page) {
    const wasShowing = Boolean(lastGood);
    lastGood = null;
    if (host) removeHost();
    // Never a blank screen: the original page is what shows now. Salebase may
    // still be drawing right after load, so keep trying for a few seconds
    // before calling it; a view that was showing and broke is logged at once.
    const waited = Date.now() - startedAt;
    if (!wasShowing && waited < GIVE_UP_AFTER_MS && !fallbackReason) { scheduleRender(500); return; }
    if (gaveUpLogged !== page.reason) {
      gaveUpLogged = page.reason;
      log('warn', 'salebase.calmFallback', { reason: page.reason, detail: page.detail, waitedMs: waited, wasShowing });
    }
    fallbackReason = page.reason;
  }

  function scheduleRender(delay = RENDER_DELAY_MS) {
    if (stopped) return;
    if (renderTimer) { if (delay > 0) return; clearTimeout(renderTimer); }
    renderTimer = setTimeout(update, delay);
  }

  // ---- Wiring ------------------------------------------------------------------
  const pageObserver = new MutationObserver((records) => {
    if (records.every((record) => host && (record.target === host || host.contains(record.target)))) return;
    scheduleRender();
  });
  // The element picker adds an outline to <html>; step aside so it can pick
  // from the real page, and come back when it's done.
  const rootObserver = new MutationObserver(() => {
    const picking = Boolean(document.getElementById(PICKER_OUTLINE_ID));
    if (picking !== pickerActive) { pickerActive = picking; scheduleRender(0); }
    if (host && !host.isConnected && wanted()) scheduleRender(0);
  });
  const onPageInput = (event) => { if (!host?.contains(event.target)) scheduleRender(40); };

  function stop() {
    stopped = true;
    pageObserver.disconnect(); rootObserver.disconnect();
    document.removeEventListener('change', onPageInput, true);
    document.removeEventListener('input', onPageInput, true);
    clearTimeout(renderTimer); clearTimeout(hitTimer);
    removeHost();
  }
  document.addEventListener(STOP_EVENT, stop, { once: true });

  function setObjection(value) {
    if (!value?.label) return;
    const isNew = !objection || objection.at !== value.at || objection.label !== value.label || objection.status !== value.status;
    objection = { ...value, dismissed: false };
    if (!ui || !isNew || !lastGood) return;
    renderHeard();
    const match = matchRebuttal(currentRebuttals(), value.label);
    if (match && (value.status === 'looking' || value.status === 'opened')) focusCard(match);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SETTING_KEY]) { enabled = changes[SETTING_KEY].newValue !== false; settingKnown = true; if (!enabled) showOriginal = false; update(); }
      if (area === 'local' && changes['impact.lastObjection']) setObjection(changes['impact.lastObjection'].newValue);
      if (area === 'session' && changes['impact.scriptLead']) { lead = changes['impact.scriptLead'].newValue?.fields || null; scheduleRender(0); }
    });
    chrome.storage.local.get([SETTING_KEY, SIZE_KEY, 'impact.lastObjection']).then((stored) => {
      enabled = stored[SETTING_KEY] !== false;
      settingKnown = true;
      if (Number.isInteger(stored[SIZE_KEY])) sizeStep = Math.max(0, Math.min(SIZES.length - 1, stored[SIZE_KEY]));
      const last = stored['impact.lastObjection'];
      if (last?.label && Date.now() - (last.at || 0) < OBJECTION_FRESH_MS) objection = { ...last, dismissed: false };
      update();
      applySize();
    }).catch(() => { settingKnown = true; update(); });
    chrome.runtime.sendMessage({ type: 'impact/getScriptLead' }).then((response) => { lead = response?.fields || null; scheduleRender(0); }).catch(() => {});
  } catch (_error) {
    // Extension context gone (updated/removed): leave the page as Salebase wrote it.
    stop();
    return;
  }
  pageObserver.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'checked'] });
  rootObserver.observe(document.documentElement, { childList: true });
  document.addEventListener('change', onPageInput, true);
  document.addEventListener('input', onPageInput, true);

  globalThis.__impactCalmView = { parsePage, parseRebuttals, matchRebuttal, compact, update, isActive: () => Boolean(host?.isConnected && ui && !ui.app.hidden && host.style.display !== 'none'), root: () => root };
})();
