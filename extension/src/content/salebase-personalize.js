// Fills the current IMPACT lead into the Salebase phone script, e.g.
// "Hey (Member), this is Cody..." -> "Hey James, this is Cody...".
// Only text nodes are touched: each placeholder is wrapped in a small span that
// keeps the original text, so a new lead updates it and no lead restores it.
(() => {
  // A copy injected before an extension update can no longer reach the
  // extension; tell it to stop (DOM events cross content-script worlds).
  const STOP_EVENT = 'impact-script-fill-stop';
  document.dispatchEvent(new Event(STOP_EVENT));

  const FIELD_ATTR = 'data-impact-fill';
  const ORIGINAL_ATTR = 'data-impact-original';
  const TOOLTIP = 'From IMPACT lead';
  const STYLE = 'font-weight:600;text-decoration:underline;text-decoration-color:rgba(13,148,136,.55);text-decoration-thickness:2px;text-underline-offset:3px;';

  // ---- The one table to adjust -------------------------------------------
  // Placeholder written in brackets in the script -> lead field.
  // Matched case-insensitively inside (…), […], {…} or {{…}}; spaces,
  // underscores and hyphens are equivalent, so (First Name) = {first_name}.
  // A field IMPACT does not have stays exactly as written.
  const PLACEHOLDER_FIELDS = {
    'member': 'firstName', 'member name': 'firstName', 'name': 'firstName', 'first name': 'firstName', 'firstname': 'firstName',
    'customer': 'firstName', 'customer name': 'firstName', 'client': 'firstName', 'client name': 'firstName', 'prospect': 'firstName',
    'last name': 'lastName', 'lastname': 'lastName',
    'full name': 'fullName', 'fullname': 'fullName', 'member full name': 'fullName',
    'address': 'address', 'full address': 'address', 'street': 'street', 'street address': 'street',
    'city': 'city', 'state': 'state', 'zip': 'zip', 'zip code': 'zip', 'zipcode': 'zip',
    'email': 'email', 'email address': 'email', 'phone': 'phone', 'phone number': 'phone',
    'dob': 'dob', 'date of birth': 'dob', 'birthday': 'dob', 'birth date': 'dob',
    'group': 'group', 'group name': 'group', 'union': 'group', 'union name': 'group', 'local': 'group', 'association': 'group', 'association name': 'group',
    'beneficiary': 'beneficiary', 'beneficiary name': 'beneficiary',
    'spouse': 'spouse', 'spouse name': 'spouse',
    'kits': 'kits', '# of kits': 'kits', 'number of kits': 'kits',
    'agent': 'agent', 'agent name': 'agent', 'your name': 'agent', 'rep name': 'agent'
  };
  // Bare placeholders (no brackets) as they appear in the real scripts. Each
  // only fires in the context shown, so ordinary words are left alone.
  const BARE_PLACEHOLDERS = [
    // "You listed your full name as NAME." Only the all-caps word on its own.
    { field: 'fullName', pattern: /(?<![A-Za-z'])NAME(?![A-Za-z'])/g, ok: (before, after) => !/\b[A-Z]{2,}\s+$/.test(before) && !/^\s*(?::|[A-Z]{2,}\b)/.test(after) },
    // "your date of birth as DOB." Read-back only: never "what's your DOB?".
    { field: 'dob', pattern: /(?<![A-Za-z'])DOB(?![A-Za-z'])/g, ok: (before) => /\b(?:as|is|was)\s+$/i.test(before) && !/\byour\s+$/i.test(before) },
    // "you requested # child safe kits."
    { field: 'kits', pattern: /#(?=\s*(?:child[\s-]*safe\s+)?kits?\b)/gi, ok: () => true }
  ];
  // -------------------------------------------------------------------------

  const BRACKETED = /\{\{\s*([^{}\n]{1,32}?)\s*\}\}|\(\s*([^()\n]{1,32}?)\s*\)|\[\s*([^[\]\n]{1,32}?)\s*\]|\{\s*([^{}\n]{1,32}?)\s*\}/g;
  const TRIGGER = /[([{#]|NAME|DOB/;
  const SKIP = 'script,style,noscript,template,textarea,input,select,option,button,a,label,[contenteditable],[role="button"],[data-impact-ui],[' + FIELD_ATTR + ']';

  const keyOf = (text) => String(text).toLowerCase().replace(/[_\-\s]+/g, ' ').trim();

  // Placeholders in one piece of text: [{ start, end, original, field }].
  function findPlaceholders(text) {
    const found = [];
    for (const match of String(text).matchAll(BRACKETED)) {
      const field = PLACEHOLDER_FIELDS[keyOf(match[1] ?? match[2] ?? match[3] ?? match[4])];
      if (field) found.push({ start: match.index, end: match.index + match[0].length, original: match[0], field });
    }
    for (const rule of BARE_PLACEHOLDERS) {
      for (const match of String(text).matchAll(rule.pattern)) {
        const start = match.index; const end = start + match[0].length;
        if (found.some((item) => start < item.end && end > item.start)) continue;
        if (rule.ok(text.slice(0, start), text.slice(end))) found.push({ start, end, original: match[0], field: rule.field });
      }
    }
    return found.sort((a, b) => a.start - b.start);
  }

  let fields = null;
  let enabled = true;
  let stopped = false;
  let observer = null;
  let timer = 0;

  const valueFor = (field) => (enabled && fields && typeof fields[field] === 'string' ? fields[field].trim() : '');

  function makeSpan(item, value) {
    const span = document.createElement('span');
    span.setAttribute(FIELD_ATTR, item.field);
    span.setAttribute(ORIGINAL_ATTR, item.original);
    span.setAttribute('title', TOOLTIP);
    span.setAttribute('style', STYLE);
    span.textContent = value;
    return span;
  }

  function restore(span) {
    let node = document.createTextNode(span.getAttribute(ORIGINAL_ATTR) || '');
    span.replaceWith(node);
    const previous = node.previousSibling;
    if (previous && previous.nodeType === 3) { previous.appendData(node.data); node.remove(); node = previous; }
    const next = node.nextSibling;
    if (next && next.nodeType === 3) { node.appendData(next.data); next.remove(); }
  }

  function fillTextNode(node) {
    const text = node.data;
    const items = findPlaceholders(text).map((item) => ({ ...item, value: valueFor(item.field) })).filter((item) => item.value);
    if (!items.length) return 0;
    const fragment = document.createDocumentFragment();
    let at = 0;
    for (const item of items) {
      if (item.start > at) fragment.append(document.createTextNode(text.slice(at, item.start)));
      fragment.append(makeSpan(item, item.value));
      at = item.end;
    }
    if (at < text.length) fragment.append(document.createTextNode(text.slice(at)));
    node.replaceWith(fragment);
    return items.length;
  }

  function candidateTextNodes(root) {
    const nodes = [];
    if (!root) return nodes;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (TRIGGER.test(node.data) && !node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    return nodes;
  }

  // Brings the page in line with the current lead. Safe to call any time.
  function refresh() {
    timer = 0;
    if (stopped || !document.body) return;
    let changes = 0;
    for (const span of Array.from(document.querySelectorAll(`[${FIELD_ATTR}]`))) {
      const value = valueFor(span.getAttribute(FIELD_ATTR));
      if (!value) { restore(span); changes += 1; } else if (span.textContent !== value) { span.textContent = value; changes += 1; }
    }
    if (enabled && fields) {
      for (const node of candidateTextNodes(document.body)) changes += fillTextNode(node);
    }
    // Our own edits must not wake the observer again.
    observer?.takeRecords();
    return changes;
  }

  function schedule() {
    if (stopped || timer) return;
    timer = setTimeout(refresh, 60);
  }

  function start() {
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    refresh();
  }

  function stop() {
    stopped = true;
    observer?.disconnect();
    if (timer) clearTimeout(timer);
  }
  document.addEventListener(STOP_EVENT, stop, { once: true });

  function setLead(next) {
    fields = next && typeof next === 'object' ? next : null;
    refresh();
  }

  try {
    // No chrome.runtime.onMessage listener here on purpose: the rebuttal
    // script in this tab owns tab messages.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['impact.fillScript']) { enabled = changes['impact.fillScript'].newValue !== false; refresh(); }
      if (area === 'session' && changes['impact.scriptLead']) setLead(changes['impact.scriptLead'].newValue?.fields);
    });
    chrome.storage.local.get('impact.fillScript').then((stored) => { enabled = stored['impact.fillScript'] !== false; refresh(); }).catch(() => {});
    // Ask the service worker once (it also enables session access for us).
    chrome.runtime.sendMessage({ type: 'impact/getScriptLead' }).then((response) => setLead(response?.fields)).catch(() => {});
  } catch (_error) {
    // Extension context gone (updated/removed): leave the page as Salebase wrote it.
    stop();
    return;
  }
  start();

  globalThis.__impactScriptFill = { findPlaceholders, refresh, setLead, PLACEHOLDER_FIELDS };
})();
