// Objection rebuttals live on the Salebase script page itself (panels next to
// the lead script). This module finds the rep's existing script tab, focuses
// it and asks a content script to open the matching panel in place.
//
// It must never open a tab or window. If no script window is open it only
// reports that back. `chromeApi` is injected so the tab choice and the
// "no new tab" guarantee can be tested without a browser.

export const SALEBASE_TAB_QUERY = ['https://salebase.ai/*', 'https://*.salebase.ai/*'];
export const REBUTTAL_CONTENT_SCRIPT = 'src/content/salebase-rebuttal.js';
export const POPUP_GUARD_MS = 2500;

export function salebaseUrlInfo(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch (_error) { return { salebase: false }; }
  const host = parsed.hostname.toLowerCase();
  const salebase = parsed.protocol === 'https:' && (host === 'salebase.ai' || host.endsWith('.salebase.ai'));
  if (!salebase) return { salebase: false };
  const path = parsed.pathname.toLowerCase();
  return {
    salebase: true,
    // phone_scripts/phone_scripts.php today; tolerate other script/call paths.
    script: /script/.test(path) || /(^|\/)call/.test(path),
    dashboard: /^\/dashboard(\/|$)/.test(path),
    login: /log_?in|sign_?in|\/auth/.test(path)
  };
}

export function isSalebaseScriptUrl(url) {
  const info = salebaseUrlInfo(url);
  return Boolean(info.salebase && info.script && !info.dashboard && !info.login);
}

// probes[tabId] is what the content script reported for that tab:
// { isScriptPage, hasRebuttal } or null when it could not be asked.
export function rankScriptTabs(tabs, probes = {}) {
  return (tabs || [])
    .filter((tab) => tab && tab.id != null && tab.id >= 0)
    .map((tab) => {
      const info = salebaseUrlInfo(tab.url);
      const probe = probes[tab.id] || null;
      if (!info.salebase || info.login) return null;
      const eligible = probe?.hasRebuttal || probe?.isScriptPage || isSalebaseScriptUrl(tab.url);
      if (!eligible) return null;
      let score = 0;
      if (probe?.hasRebuttal) score += 1000;
      if (probe?.isScriptPage) score += 500;
      if (isSalebaseScriptUrl(tab.url)) score += 200;
      if (info.dashboard) score -= 300;
      if (tab.active) score += 20;
      if (tab.discarded) score -= 100;
      return { tab, score };
    })
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || ((b.tab.lastAccessed || 0) - (a.tab.lastAccessed || 0)));
}

export function chooseScriptTab(tabs, probes = {}) {
  return rankScriptTabs(tabs, probes)[0]?.tab || null;
}

export async function findSalebaseTabs(chromeApi) {
  const tabs = await chromeApi.tabs.query({ url: SALEBASE_TAB_QUERY });
  return (tabs || []).filter((tab) => tab?.id != null && salebaseUrlInfo(tab.url).salebase);
}

export async function findSalebaseScriptTabs(chromeApi) {
  return (await findSalebaseTabs(chromeApi)).filter((tab) => isSalebaseScriptUrl(tab.url));
}

// Message the rebuttal content script, injecting it first if it is not there.
export async function messageRebuttalScript(chromeApi, tabId, message) {
  try {
    return await chromeApi.tabs.sendMessage(tabId, message);
  } catch (_notInjected) {
    try {
      await chromeApi.scripting.executeScript({ target: { tabId }, files: [REBUTTAL_CONTENT_SCRIPT] });
      return await chromeApi.tabs.sendMessage(tabId, message);
    } catch (_error) {
      return null; // Discarded, signed out, reloading or not permitted.
    }
  }
}

function pathOnly(url) {
  try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}`; } catch (_error) { return null; }
}

// Safety net: Salebase's own click handlers must not be able to spawn a tab or
// popup while we open a panel. Block window.open in the page for a moment and
// close anything the script tab still opens during that window.
async function guardAgainstNewTabs(chromeApi, tabId) {
  const closed = [];
  const onCreated = (created) => {
    if (created?.openerTabId !== tabId || created.id == null) return;
    closed.push(pathOnly(created.pendingUrl || created.url) || 'about:blank');
    Promise.resolve(chromeApi.tabs.remove(created.id)).catch(() => {});
  };
  chromeApi.tabs.onCreated?.addListener(onCreated);
  try {
    await chromeApi.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (ms) => {
        const original = window.open;
        const blocked = function blockedDuringRebuttal() {
          console.info('[IMPACT Companion] Blocked a new window while opening a rebuttal.');
          return null;
        };
        window.open = blocked;
        setTimeout(() => { if (window.open === blocked) window.open = original; }, ms);
      },
      args: [POPUP_GUARD_MS]
    });
  } catch (_error) { /* The tab listener below still protects the rep. */ }
  return {
    closed,
    release: (delay = POPUP_GUARD_MS) => new Promise((resolve) => {
      const done = () => { chromeApi.tabs.onCreated?.removeListener(onCreated); resolve(closed); };
      if (delay > 0) setTimeout(done, delay); else done();
    })
  };
}

const ACTION_TEXT = {
  'clicked-title': 'clicked its title',
  'clicked-title-then-revealed': 'clicked its title and showed the hidden text',
  'clicked-toggle': 'clicked its toggle',
  'opened-details': 'opened it',
  'already-open': 'it was already open',
  'skipped-navigating-link': 'showed it without following its link',
  'skipped-navigating-link-then-revealed': 'showed it without following its link'
};

// Turns the page script's answer into a status that names the stage that failed.
export function describeOutcome(detail, label) {
  if (!detail) {
    return { status: 'page-not-reachable', stage: 'talk-to-page', message: 'Found the Salebase script window but could not talk to the page. Reload the Salebase tab and try again.' };
  }
  if (detail.ok === false) {
    return { status: 'page-error', stage: 'open-panel', message: `The Salebase page script failed: ${detail.error || 'unknown error'}.` };
  }
  if (!detail.found) {
    return { status: 'rebuttal-not-found', stage: 'find-panel', message: `Salebase script window found, but the “${label}” rebuttal was not found on it.` };
  }
  return { status: 'opened', stage: 'done', action: detail.action || '', message: `“${label}”: ${ACTION_TEXT[detail.action] || detail.action || 'opened'} in the Salebase script window.` };
}

export async function revealRebuttalInScriptTab(chromeApi, match, options = {}) {
  const request = { label: match?.label || '', phrases: match?.phrases || [], otherLabels: options.otherLabels || [] };
  const salebaseTabs = await findSalebaseTabs(chromeApi);
  const seen = salebaseTabs.map((tab) => ({ id: tab.id, url: pathOnly(tab.url), active: Boolean(tab.active) }));
  if (!salebaseTabs.length) {
    return { status: 'no-script-window', stage: 'find-script-tab', message: 'No Salebase script window is open.', tabsSeen: seen };
  }

  // Ask every Salebase tab (read-only) whether it shows the script and has the
  // rebuttal, so the tab actually showing the script wins.
  const probes = {};
  await Promise.all(salebaseTabs.map(async (tab) => {
    if (tab.discarded) { probes[tab.id] = null; return; }
    probes[tab.id] = await messageRebuttalScript(chromeApi, tab.id, { type: 'impact/probeRebuttal', ...request });
  }));
  const tab = chooseScriptTab(salebaseTabs, probes);
  if (!tab) {
    return { status: 'no-script-window', stage: 'find-script-tab', message: 'No Salebase script window is open.', tabsSeen: seen, probes };
  }

  try {
    if (tab.windowId != null) await chromeApi.windows.update(tab.windowId, { focused: true });
    await chromeApi.tabs.update(tab.id, { active: true });
  } catch (_error) { /* A window closing mid-call does not interrupt calling. */ }

  const guard = await guardAgainstNewTabs(chromeApi, tab.id);
  const detail = await messageRebuttalScript(chromeApi, tab.id, { type: 'impact/revealRebuttal', ...request });
  const closedTabs = await guard.release(options.guardMs ?? POPUP_GUARD_MS);
  return {
    ...describeOutcome(detail, request.label),
    tabId: tab.id,
    url: pathOnly(tab.url),
    tabsSeen: seen,
    probe: probes[tab.id] || null,
    detail,
    closedTabs
  };
}
