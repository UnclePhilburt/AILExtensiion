// Injected on demand into the Salebase script page. Finds the rebuttal panel
// for a detected objection and opens it in place. It never follows a link that
// navigates or opens a tab: those are skipped (and blocked if a click reaches
// them) and the panel is revealed directly instead.
(() => {
  if (globalThis.__impactCompanionRebuttalLoaded) return;
  globalThis.__impactCompanionRebuttalLoaded = true;

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION', 'OPTGROUP', 'SELECT', 'TEXTAREA', 'INPUT', 'HEAD', 'TITLE', 'SVG', 'IFRAME']);
  const TOGGLE_ATTRS = ['data-toggle', 'data-bs-toggle', 'data-target', 'data-bs-target', 'aria-controls', 'aria-expanded'];
  const HEADER_HINT = /panel|accordion|collapse|rebuttal|objection|heading|header|title|toggle|card|question/i;
  const UNSAFE_SCRIPT = /window\.open|\bopen\s*\(|location|\.href\s*=|\.submit\s*\(/i;

  const compact = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const attr = (element, name) => (element?.getAttribute ? element.getAttribute(name) : null);
  const tagOf = (element) => String(element?.tagName || '').toUpperCase();

  function* elementsUnder(root) {
    const stack = root ? [...Array.from(root.children || [])].reverse() : [];
    while (stack.length) {
      const element = stack.pop();
      if (SKIP_TAGS.has(tagOf(element))) continue;
      yield element;
      const children = Array.from(element.children || []);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
    }
  }

  function ancestors(element, limit = 6) {
    const list = [];
    for (let node = element; node && list.length <= limit; node = node.parentElement) {
      if (node === document.body || tagOf(node) === 'BODY' || tagOf(node) === 'HTML') break;
      list.push(node);
    }
    return list;
  }

  function isShown(element) {
    return Boolean(element && typeof element.getClientRects === 'function' && element.getClientRects().length > 0);
  }

  function isToggleLike(element) {
    const tag = tagOf(element);
    return tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A' || attr(element, 'role') === 'button' ||
      element.hasAttribute?.('onclick') || TOGGLE_ATTRS.some((name) => element.hasAttribute?.(name));
  }

  function samePage(href) {
    try {
      const target = new URL(href, location.href);
      const here = new URL(location.href);
      return target.origin === here.origin && target.pathname === here.pathname && target.search === here.search;
    } catch (_error) { return false; }
  }

  // Would clicking this element leave the page or open a tab/window?
  function classify(element) {
    if (!element) return { safe: true };
    const onclick = attr(element, 'onclick') || '';
    if (onclick && UNSAFE_SCRIPT.test(onclick)) return { safe: false, reason: 'onclick opens or navigates' };
    const href = attr(element, 'href');
    const target = attr(element, 'target');
    const isLink = tagOf(element) === 'A' || tagOf(element) === 'AREA';
    if (isLink && href !== null) {
      if (target && !/^_self$/i.test(target)) return { safe: false, reason: `link target=${target}`, href };
      const value = href.trim();
      if (value === '' || value.startsWith('#')) return { safe: true };
      if (/^javascript:/i.test(value)) {
        return UNSAFE_SCRIPT.test(value) ? { safe: false, reason: 'javascript link opens or navigates', href } : { safe: true };
      }
      if (samePage(value) && value.includes('#')) return { safe: true };
      return { safe: false, reason: 'link navigates', href };
    }
    return { safe: true };
  }

  function closestLink(element) {
    return ancestors(element, 8).find((node) => (tagOf(node) === 'A' || tagOf(node) === 'AREA') && attr(node, 'href') !== null) || null;
  }

  function findToggle(element) {
    return ancestors(element, 5).find(isToggleLike) || null;
  }

  function headerish(element) {
    if (findToggle(element)) return 2;
    const near = ancestors(element, 3);
    if (near.some((node) => /^(H[1-6]|SUMMARY|BUTTON|DT|LEGEND|LABEL)$/.test(tagOf(node)))) return 1;
    if (near.some((node) => HEADER_HINT.test(`${attr(node, 'class') || ''} ${node.id || ''}`))) return 1;
    return 0;
  }

  function findRebuttal(label, phrases) {
    const wantedLabel = compact(label);
    const wantedPhrases = (phrases || []).map(compact).filter((value) => value.length > 5);
    const matches = [];
    for (const element of elementsUnder(document.body)) {
      const text = compact(element.textContent);
      if (!text) continue;
      let rank = 0; let kind = '';
      if (wantedLabel.length > 5 && text === wantedLabel) { rank = 3; kind = 'label-exact'; }
      else if (wantedLabel.length > 5 && text.includes(wantedLabel)) { rank = 2; kind = 'label'; }
      else if (wantedPhrases.some((phrase) => text.includes(phrase))) { rank = 1; kind = 'phrase'; }
      if (!rank) continue;
      const clickTarget = findToggle(element) || element;
      const safe = classify(clickTarget).safe && classify(closestLink(clickTarget)).safe ? 1 : 0;
      matches.push({ element, rank, kind, length: text.length, shown: isShown(element) ? 1 : 0, safe, header: headerish(element) });
    }
    // Best: strongest text match, visible, openable in place, header-like, innermost.
    matches.sort((a, b) => (b.rank - a.rank) || (b.shown - a.shown) || (b.safe - a.safe) || (b.header - a.header) || (a.length - b.length));
    return { best: matches[0] || null, count: matches.length, top: matches.slice(0, 3) };
  }

  function byId(value) {
    const id = String(value || '').trim().replace(/^#/, '');
    if (!id || /[\s,>]/.test(id)) return null;
    return document.getElementById(id);
  }

  // The panel body the toggle controls, when the page says so explicitly.
  function explicitBody(nodes) {
    for (const node of nodes) {
      for (const name of ['aria-controls', 'data-bs-target', 'data-target']) {
        const found = byId(attr(node, name));
        if (found) return found;
      }
      const href = attr(node, 'href');
      if (href && href.trim().length > 1 && href.trim().startsWith('#')) {
        const found = byId(href.trim());
        if (found) return found;
      }
    }
    return null;
  }

  // Otherwise the hidden element right after the header is very likely the body.
  function hiddenSiblingBody(element) {
    for (const node of ancestors(element, 3)) {
      const next = node.nextElementSibling;
      if (next && !SKIP_TAGS.has(tagOf(next))) return isShown(next) ? null : next;
    }
    return null;
  }

  function forceShow(body, toggle) {
    body.hidden = false;
    body.removeAttribute?.('hidden');
    if (body.style && body.style.display === 'none') body.style.display = '';
    body.classList?.add('in', 'show');
    if (!isShown(body) && body.style) body.style.display = 'block';
    toggle?.setAttribute?.('aria-expanded', 'true');
  }

  function describe(element) {
    if (!element) return null;
    const href = attr(element, 'href');
    return {
      tag: tagOf(element).toLowerCase(),
      id: element.id || '',
      classes: String(attr(element, 'class') || '').split(/\s+/).filter(Boolean).slice(0, 4).join(' '),
      role: attr(element, 'role') || '',
      toggleAttrs: TOGGLE_ATTRS.filter((name) => element.hasAttribute?.(name)).map((name) => `${name}=${attr(element, name)}`),
      href: href === null ? null : href.split(/[?]/)[0].slice(0, 120),
      target: attr(element, 'target') || '',
      onclick: Boolean(attr(element, 'onclick')),
      text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    };
  }

  // Any click we cause must not follow a navigating/new-tab link.
  function clickWithoutNavigation(element) {
    const blocked = [];
    const guard = (event) => {
      const link = closestLink(event.target);
      if (link && !classify(link).safe) { event.preventDefault(); blocked.push(describe(link)); }
    };
    globalThis.addEventListener('click', guard, true);
    try { element.click(); } finally { globalThis.removeEventListener('click', guard, true); }
    return blocked;
  }

  function highlight(element) {
    if (!element?.style) return;
    const previous = element.style.outline;
    element.style.outline = '3px solid #f59e0b';
    setTimeout(() => { element.style.outline = previous; }, 2500);
  }

  function isScriptPage() {
    return tagOf(document.getElementById('myDropdown')) === 'SELECT';
  }

  function probe(label, phrases) {
    const found = findRebuttal(label, phrases);
    return { ok: true, isScriptPage: isScriptPage(), hasRebuttal: Boolean(found.best), matchKind: found.best?.kind || '' };
  }

  function reveal(label, phrases) {
    const found = findRebuttal(label, phrases);
    const debug = { isScriptPage: isScriptPage(), candidates: found.count, top: found.top.map((item) => ({ kind: item.kind, ...describe(item.element) })) };
    if (!found.best) return { ok: true, found: false, reason: 'No element on the page contains the rebuttal label or phrases.', ...debug };

    const header = found.best.element;
    const toggle = findToggle(header);
    const clickTarget = toggle || header;
    const link = closestLink(clickTarget);
    const safety = classify(clickTarget).safe ? classify(link) : classify(clickTarget);
    const chain = ancestors(clickTarget, 3);
    const body = explicitBody(chain);
    const guessed = body ? null : hiddenSiblingBody(clickTarget);
    const details = ancestors(header, 8).find((node) => tagOf(node) === 'DETAILS') || null;

    let action;
    let blocked = [];
    if (details) {
      details.open = true; action = 'opened-details';
    } else if (attr(toggle, 'aria-expanded') === 'true' || (body && isShown(body))) {
      action = 'already-open';
    } else if (safety.safe) {
      blocked = clickWithoutNavigation(clickTarget); action = 'clicked-toggle';
    } else {
      action = 'skipped-navigating-link';
    }

    const panelBody = body || guessed;
    let forced = false;
    if (panelBody && action !== 'already-open' && !isShown(panelBody)) { forceShow(panelBody, toggle); forced = true; }

    const anchor = toggle || header;
    try { anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_error) { anchor.scrollIntoView?.(); }
    highlight(anchor);

    return {
      ok: true,
      found: true,
      matchKind: found.best.kind,
      action,
      forcedVisible: forced,
      skippedLink: safety.safe ? null : { reason: safety.reason, href: String(safety.href || '').split(/[?]/)[0].slice(0, 120) },
      blockedNavigation: blocked,
      header: describe(header),
      toggle: describe(toggle),
      body: describe(panelBody),
      bodyShown: panelBody ? isShown(panelBody) : null,
      ...debug
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === 'impact/probeRebuttal') { sendResponse(probe(message.label, message.phrases)); return false; }
      if (message?.type === 'impact/revealRebuttal') { sendResponse(reveal(message.label, message.phrases)); return false; }
    } catch (error) {
      sendResponse({ ok: false, found: false, error: error.message });
    }
    return false;
  });
})();
