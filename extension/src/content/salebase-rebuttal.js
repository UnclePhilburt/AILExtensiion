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

  const NON_CONTENT = new Set([...SKIP_TAGS, 'BR', 'HR', 'IMG', 'BUTTON']);
  // Salebase's rebuttal list starts with "Expand All" / "Collapse All". Those
  // must never be clicked: they would open or close every rebuttal.
  const BULK_TEXT = /^(expandall|collapseall|expand|collapse|showall|hideall|openall|closeall)$/;
  const OPEN_WAIT_MS = 700;

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
      if (!text || BULK_TEXT.test(text)) continue;
      if (text.includes('expandall') || text.includes('collapseall')) continue; // the whole list, not one rebuttal
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
    // For <p><span>Title</span></p> this is the outer <p> (or the wrapper when
    // it holds only the title) - the element 0.4.10 clicked on the real page.
    // Do not descend to the inner span: a handler like
    // $(e.target).next().toggle() only works when the <p> is the target.
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

  const isPageRoot = (node) => !node || node === document.body || tagOf(node) === 'BODY' || tagOf(node) === 'HTML';

  function visibleText(element) {
    if (!isShown(element)) return '';
    return compact(typeof element.innerText === 'string' ? element.innerText : element.textContent);
  }

  function mentionsOtherRebuttals(element, otherLabels) {
    const text = compact(element.textContent);
    return text.includes('expandall') || text.includes('collapseall') || otherLabels.some((label) => text.includes(label));
  }

  function signature(element) {
    const parts = [];
    for (let node = element, depth = 0; node && depth < 3; node = node.firstElementChild, depth += 1) parts.push(tagOf(node));
    return parts.join('>');
  }

  // Salebase: container div > [Expand All, Collapse All, span wrapper per
  // rebuttal]. Each wrapper starts with <p><span>Title</span></p>; the body is
  // either the wrapper's later children or the siblings up to the next wrapper.
  function findSection(title, otherLabels) {
    const titleText = compact(title.textContent);
    let block = title;
    while (!isPageRoot(block.parentElement) && compact(block.parentElement.textContent) === titleText) block = block.parentElement;
    let section = block;
    for (let depth = 0; depth < 6 && !isPageRoot(section.parentElement); depth += 1) {
      if (mentionsOtherRebuttals(section.parentElement, otherLabels)) {
        return { block, section, container: section.parentElement };
      }
      section = section.parentElement;
    }
    return { block, section: block, container: null };
  }

  function sectionBodies(section, block) {
    const inner = [];
    for (let node = block; node && node !== section; node = node.parentElement) {
      for (let next = node.nextElementSibling; next; next = next.nextElementSibling) {
        if (!NON_CONTENT.has(tagOf(next))) inner.push(next);
      }
    }
    if (inner.length) return { placement: 'inside-wrapper', bodies: inner };
    const outer = [];
    const own = signature(section);
    for (let next = section.nextElementSibling; next; next = next.nextElementSibling) {
      if (NON_CONTENT.has(tagOf(next))) continue;
      const text = compact(next.textContent);
      if (signature(next) === own || BULK_TEXT.test(text) || text.includes('expandall')) break; // next rebuttal
      outer.push(next);
    }
    return { placement: outer.length ? 'after-wrapper' : 'none', bodies: outer };
  }

  const hasText = (element) => compact(element.textContent).length > 0;
  const isOpenBody = (bodies) => bodies.some((body) => hasText(body) && visibleText(body).length > 0);

  // Show this rebuttal's hidden body parts only; other rebuttals are untouched.
  function revealBodies(bodies) {
    let changed = 0;
    for (const body of bodies) {
      if (!hasText(body)) continue;
      if (!isShown(body)) { forceShow(body); changed += 1; }
      if (visibleText(body)) continue;
      for (const inner of elementsUnder(body)) {
        if (hasText(inner) && !isShown(inner) && (inner.parentElement === body || isShown(inner.parentElement))) { forceShow(inner); changed += 1; }
      }
    }
    return changed;
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

  function probe(label, phrases, titles) {
    const found = findRebuttal(label, phrases);
    // Any of the objection's Salebase titles on the page counts (each script words it its own way).
    const hasTitle = (titles || []).some((title) => findRebuttal(title, []).best);
    return { ok: true, isScriptPage: isScriptPage(), hasRebuttal: Boolean(found.best) || hasTitle, matchKind: found.best?.kind || (hasTitle ? 'title' : '') };
  }

  // Read-only: every rebuttal title on the page, which script it belongs to and
  // whether it is showing (only the selected script's rebuttals are).
  function listRebuttals() {
    const dropdown = document.getElementById('myDropdown');
    const rebuttals = [...document.querySelectorAll('.rebuttal-item')].map((item) => {
      const heading = item.querySelector('.ConditionalChar') || item;
      const copy = heading.cloneNode(true);
      copy.querySelectorAll('.rebuttal-answer').forEach((node) => node.remove());
      const group = item.closest('.script-type');
      const script = group ? ([...group.classList].find((name) => name !== 'script-type') || '') : '';
      return { title: String(copy.textContent || '').replace(/\s+/g, ' ').trim(), script, shown: isShown(item) };
    }).filter((rebuttal) => rebuttal.title);
    return { ok: true, isScriptPage: isScriptPage(), activeScript: tagOf(dropdown) === 'SELECT' ? dropdown.value : '', rebuttals };
  }

  function focusPanel(anchor) {
    try { anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_error) { anchor.scrollIntoView?.(); }
    highlight(anchor);
  }

  function finish(result, anchor) {
    focusPanel(anchor);
    return result;
  }

  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  async function reveal(label, phrases, otherLabels = []) {
    const found = findRebuttal(label, phrases);
    const debug = { isScriptPage: isScriptPage(), candidates: found.count, top: found.top.map((item) => ({ kind: item.kind, ...describe(item.element) })) };
    if (!found.best) return { ok: true, found: false, reason: 'No element on the page contains the rebuttal label or phrases.', ...debug };

    const header = found.best.element; // the title element 0.4.10 clicked
    const toggle = findToggle(header);
    const clickTarget = toggle || header;
    const unsafe = [classify(clickTarget), classify(header), classify(closestLink(clickTarget))].find((item) => !item.safe);
    const safety = unsafe || { safe: true };
    const body = explicitBody(ancestors(clickTarget, 3));
    const details = ancestors(header, 8).find((node) => tagOf(node) === 'DETAILS') || null;
    const others = (otherLabels || []).map(compact).filter((value) => value.length > 5 && value !== compact(label));
    const section = details || body ? null : findSection(header, others);
    const parts = section ? sectionBodies(section.section, section.block) : { placement: 'none', bodies: [] };
    const base = {
      ok: true,
      found: true,
      matchKind: found.best.kind,
      skippedLink: safety.safe ? null : { reason: safety.reason, href: String(safety.href || '').split(/[?]/)[0].slice(0, 120) },
      header: describe(header),
      toggle: describe(toggle),
      ...debug
    };

    // Salebase shape: a wrapper per rebuttal whose body parts we can see.
    if (parts.bodies.length) {
      const bodies = parts.bodies;
      const summary = () => ({
        panel: describe(section.section),
        container: describe(section.container),
        bodyPlacement: parts.placement,
        bodyParts: bodies.length,
        body: describe(bodies[0]),
        bodyShown: isOpenBody(bodies)
      });
      // 0.4.10's proven behaviour: always click the title, like the rep would.
      // Never skip the click on a guess that the panel is already open: a
      // max-height/opacity accordion looks "visible" while it is collapsed,
      // which made 0.4.11/0.4.12 skip every rebuttal on the real page.
      let action; let blocked = []; let forced = 0;
      if (safety.safe) {
        blocked = clickWithoutNavigation(clickTarget);
        action = 'clicked-title';
      } else {
        action = 'skipped-navigating-link';
      }
      focusPanel(section.section);
      // Safe addition: once the page's own toggle has finished, if this
      // rebuttal's body is still plainly hidden (display:none / hidden), show it.
      await sleep(OPEN_WAIT_MS);
      if (!isOpenBody(bodies)) {
        forced = revealBodies(bodies);
        if (forced && safety.safe) action = `${action}-then-revealed`;
      }
      return { ...base, action, forcedVisible: forced > 0, blockedNavigation: blocked, ...summary() };
    }

    // Other shapes: <details>, Bootstrap-style toggles, or a hidden next sibling.
    const guessed = body ? null : hiddenSiblingBody(clickTarget);
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
    return finish({
      ...base,
      action,
      forcedVisible: forced,
      blockedNavigation: blocked,
      panel: section ? describe(section.section) : null,
      bodyPlacement: body ? 'controlled' : guessed ? 'next-sibling' : 'none',
      body: describe(panelBody),
      bodyShown: panelBody ? isShown(panelBody) : null
    }, toggle || header);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === 'impact/probeRebuttal') { sendResponse(probe(message.label, message.phrases, message.titles)); return false; }
      if (message?.type === 'impact/listRebuttals') { sendResponse(listRebuttals()); return false; }
      if (message?.type === 'impact/revealRebuttal') {
        reveal(message.label, message.phrases, message.otherLabels)
          .then(sendResponse)
          .catch((error) => sendResponse({ ok: false, found: false, error: error.message }));
        return true;
      }
    } catch (error) {
      sendResponse({ ok: false, found: false, error: error.message });
    }
    return false;
  });
})();
