import { LOG_LIMIT, STORAGE_KEYS } from "../shared/storage-keys.js";
import { parseBridgeUrl } from "../shared/bridge-config.js";
import { accessToken } from "../shared/auth-runtime.js";
import { cloudEnabled } from '../shared/cloud-sync.js';
import { publishCloud, takeCloudCommand, reportCloudResult } from './cloud-desktop.js';
import { SALEBASE_SCRIPTS_URL, salebaseOptionForRequestType } from './salebase-scripts.js';
import { createObjectionDetector, REBUTTAL_LABELS } from './objection-matcher.js';
import { findSalebaseTabs, findSalebaseScriptTabs, isSalebaseScriptUrl, revealRebuttalInScriptTab } from './salebase-rebuttal.js';

let lastAutoPublishFingerprint = "";
let lastAutoPublishAt = 0;
let lastPublishedLead = null;
let pendingSalebaseOption = '';
let lastSalebaseOpenKey = '';
let objectionListening = false;
// One detected objection opens its rebuttal once, not on every repeat.
const objectionDetector = createObjectionDetector();
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' && isSalebaseScriptUrl(tab.url) && pendingSalebaseOption) {
    void selectSalebaseScript(tabId, pendingSalebaseOption);
  }
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes['impact.supabase.session']) {
    lastAutoPublishFingerprint = '';
    lastPublishedLead = null;
    void chrome.storage.local.remove([STORAGE_KEYS.lastSnapshot, STORAGE_KEYS.inboxQueue]);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'impact/authStatus') {
    accessToken().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === 'impact/getObjectionListening') {
    sendResponse({ ok: true, listening: objectionListening });
    return false;
  }
  if (message?.type === 'impact/setObjectionListening') {
    setObjectionListening(Boolean(message.enabled))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'impact/installEnglishSpeechPack') {
    installEnglishSpeechPack()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'impact/objectionListenerState') {
    objectionListening = Boolean(message.listening);
    void chrome.storage.local.set({ 'impact.objectionListening': objectionListening });
    return false;
  }
  if (message?.type === 'impact/objectionListenerError') {
    objectionListening = false;
    void chrome.storage.local.set({ 'impact.objectionListening': false, 'impact.objectionListenerError': message.error || 'Local listening stopped.' });
    return false;
  }
  if (message?.type === 'impact/objectionTranscript') {
    void handleObjectionTranscript(message.transcript);
    return false;
  }
  if (message?.type === "impact/log") {
    appendLog(message.entry, sender).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "impact/getLogs") {
    chrome.storage.local.get(STORAGE_KEYS.logs).then((result) => {
      sendResponse({ ok: true, logs: (result[STORAGE_KEYS.logs] || []).map(scrubLogEntry) });
    });
    return true;
  }

  if (message?.type === "impact/clearLogs") {
    chrome.storage.local.set({ [STORAGE_KEYS.logs]: [] }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "impact/publishLead") {
    publishLead(message.lead)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "impact/autoPublishLead") {
    autoPublishLead(message.lead, sender.tab)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "impact/publishAppointmentOptions") {
    publishAppointmentOptions(message.appointmentOptions, sender.tab)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "impact/getPhoneCommand") {
    getPhoneCommand(sender.tab)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "impact/commandResult") {
    reportCommandResult(message.message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function setObjectionListening(enabled) {
  if (!enabled) {
    try { await chrome.runtime.sendMessage({ type: 'impact/offscreenSetObjectionListening', enabled: false }); } catch (_error) {}
    objectionListening = false;
    await chrome.storage.local.set({ 'impact.objectionListening': false, 'impact.objectionListenerError': '' });
    return { listening: false };
  }
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!contexts.length) {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/listener.html',
      reasons: ['USER_MEDIA'],
      justification: 'Listen locally for enabled objection-rebuttal matching.'
    });
  }
  const result = await chrome.runtime.sendMessage({ type: 'impact/offscreenSetObjectionListening', enabled: true });
  if (!result?.ok) throw new Error(result?.error || 'Could not start local listening.');
  objectionListening = true;
  await chrome.storage.local.set({ 'impact.objectionListening': true, 'impact.objectionListenerError': '' });
  return { listening: true };
}

async function ensureListenerDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!contexts.length) await chrome.offscreen.createDocument({
    url: 'src/offscreen/listener.html',
    reasons: ['USER_MEDIA'],
    justification: 'Use the browser’s on-device English speech pack for opt-in objection matching.'
  });
}

async function installEnglishSpeechPack() {
  await ensureListenerDocument();
  const result = await chrome.runtime.sendMessage({ type: 'impact/installEnglishSpeechPack' });
  if (!result?.ok) throw new Error(result?.error || 'Could not install the English speech pack.');
  return result;
}

async function handleObjectionTranscript(transcript) {
  // Optional extra phrases per objection id, e.g.
  // { "forgot": ["that was my late husband"] }, merged with the built-in ones.
  // Nothing here stores the transcript: only labels, scores and outcomes.
  let detection;
  try {
    const stored = await chrome.storage.local.get('impact.objectionPhrases').catch(() => ({}));
    detection = objectionDetector.detect(transcript, Date.now(), { customPhrases: stored['impact.objectionPhrases'] });
  } catch (error) {
    await chrome.storage.local.set({ 'impact.lastHeard': { at: Date.now(), outcome: 'matcher-error' } });
    await appendLocalLog('error', 'objection.matcherError', { reason: error.message });
    return;
  }
  const { match } = detection;
  // Shows in the popup that speech is arriving and whether it matched.
  await chrome.storage.local.set({ 'impact.lastHeard': { at: Date.now(), outcome: detection.reason, label: (match || detection.suppressed)?.label || '' } });
  if (detection.reason === 'cooldown') {
    await appendLocalLog('info', 'objection.cooldown', { label: detection.suppressed.label });
    return;
  }
  if (!match) return;
  await chrome.storage.local.set({ 'impact.lastObjection': { label: match.label, at: Date.now(), status: 'looking', stage: 'matched', score: match.score, via: match.via } });
  await revealSalebaseRebuttal(match);
}

async function revealSalebaseRebuttal(match) {
  // Rebuttals are panels on the Salebase script page. Open the matching panel
  // in the rep's existing script tab; never open a new tab or window for it.
  let result;
  try {
    result = await revealRebuttalInScriptTab(chrome, match, { otherLabels: REBUTTAL_LABELS.filter((label) => label !== match.label) });
  } catch (error) {
    result = { status: 'error', stage: 'open-rebuttal', message: `Could not open the rebuttal: ${error.message}` };
  }
  await chrome.storage.local.set({
    'impact.lastObjection': { label: match.label, at: Date.now(), status: result.status, stage: result.stage || '', action: result.action || '', message: result.message, score: match.score, via: match.via }
  });
  await appendLocalLog(result.status === 'opened' ? 'info' : 'warn', 'salebase.rebuttal', {
    label: match.label,
    status: result.status,
    stage: result.stage || '',
    matchScore: match.score,
    matchedBy: match.via,
    message: result.message,
    tabId: result.tabId ?? null,
    url: result.url || null,
    tabsSeen: result.tabsSeen || [],
    probe: result.probe || null,
    closedTabs: result.closedTabs || [],
    // What the content script saw on the page, so a mismatch can be diagnosed.
    page: result.detail || null
  });
  return result;
}

async function getPhoneCommand(senderTab) {
  // The content script only polls while its page is visible. Do not ask Chrome
  // for the "last focused" browser tab here: opening the extension popup can
  // briefly change that answer and make the command wait until the popup is
  // opened again. Validate the requesting IMPACT page instead.
  if (!senderTab?.id ||
      !/^https:\/\/mobile\.impact\.ailife\.com\/Lead\/(InboxDetail|WhatHappend|SetAppointment)(?:[?#]|$)/.test(senderTab.url || "")) {
    return { command: null };
  }
  if (await cloudEnabled()) return takeCloudCommand();
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.bridgeUrl,
    STORAGE_KEYS.bridgeToken
  ]);
  const bridgeUrl = parseBridgeUrl(result[STORAGE_KEYS.bridgeUrl]);
  const bridgeToken = result[STORAGE_KEYS.bridgeToken] || "";

  if (!bridgeToken) {
    return { command: null };
  }

  // A short request avoids leaving a waiting consumer behind when the tab
  // navigates or loses focus. The content script repeats it every 100 ms.
  const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/api/command/next?token=${encodeURIComponent(bridgeToken)}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(8000),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Bridge command poll failed: HTTP ${response.status}`);
  }

  return response.json();
}

async function publishAppointmentOptions(appointmentOptions, senderTab) {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!senderTab?.id || senderTab.id !== active?.id ||
      !/^https:\/\/mobile\.impact\.ailife\.com\/Lead\/SetAppointment(?:[?#]|$)/.test(active?.url || "")) {
    return { skipped: true, reason: "inactive appointment tab" };
  }
  if (!lastPublishedLead?.available || !appointmentOptions?.leadId || appointmentOptions.leadId !== lastPublishedLead.leadId) {
    throw new Error("Appointment options do not match the current lead.");
  }
  return publishLead({ ...lastPublishedLead, appointmentOptions }, { eventName: "cloud.appointmentOptionsPublished" });
}

async function reportCommandResult(message) {
  if (await cloudEnabled()) return reportCloudResult(message);
  const settings = await chrome.storage.local.get([STORAGE_KEYS.bridgeUrl, STORAGE_KEYS.bridgeToken]);
  const response = await fetch(`${parseBridgeUrl(settings[STORAGE_KEYS.bridgeUrl])}/api/command/result`, {
    method: "POST", signal: AbortSignal.timeout(8000),
    headers: { "content-type": "application/json", "x-bridge-token": settings[STORAGE_KEYS.bridgeToken] || "", Authorization: `Bearer ${await accessToken()}` },
    body: JSON.stringify({ message })
  });
  if (!response.ok) throw new Error("Could not report command result.");
}

async function autoPublishLead(lead, senderTab) {
  const [active] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if (!senderTab?.id || senderTab.id !== active?.id) return {skipped:true,reason:'inactive tab'};
  const result = await chrome.storage.local.get(STORAGE_KEYS.autoPublish);
  const autoPublish = result[STORAGE_KEYS.autoPublish] !== false;

  if (!autoPublish) {
    return { skipped: true, reason: "autoPublish disabled" };
  }

  const fingerprint = makeLeadFingerprint(lead);
  const bearer = await accessToken();
  const refreshAfter = await cloudEnabled() ? 30000 : 900000;
  if (`${bearer}:${fingerprint}` === lastAutoPublishFingerprint && Date.now() - lastAutoPublishAt < refreshAfter) {
    return { skipped: true, reason: "duplicate lead payload" };
  }

  try {
    const result = await publishLead(lead, { eventName: "bridge.leadAutoPublished" });
    lastAutoPublishFingerprint = `${bearer}:${fingerprint}`;
    lastAutoPublishAt = Date.now();
    return result;
  } catch (error) {
    await appendLocalLog("warn", "bridge.autoPublishFailed", {
      reason: error.message
    });
    return { skipped: true, reason: error.message };
  }
}

async function publishLead(lead, options = {}) {
  if (!lead?.available) {
    throw new Error("No lead payload available to send.");
  }
  lastPublishedLead = structuredClone(lead);
  void openMatchingSalebaseScript(lead.requestType, lead.leadId || lead.leadName || '');
  if (await cloudEnabled()) return publishCloud(lead);

  const result = await chrome.storage.local.get([
    STORAGE_KEYS.bridgeUrl,
    STORAGE_KEYS.bridgeToken
  ]);
  const bridgeUrl = parseBridgeUrl(result[STORAGE_KEYS.bridgeUrl]);
  const bridgeToken = result[STORAGE_KEYS.bridgeToken] || "";

  if (!bridgeToken) {
    throw new Error("Bridge token is missing. Start the phone bridge and paste its token in Options.");
  }

  const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/api/current-lead`, {
    signal: AbortSignal.timeout(8000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "content-type": "application/json",
      "x-bridge-token": bridgeToken
    },
    body: JSON.stringify({
      lead,
      sentAt: new Date().toISOString()
    })
  });

  if (!response.ok) {
    throw new Error(`Bridge rejected lead update: HTTP ${response.status}`);
  }

  await appendLocalLog("info", options.eventName || "bridge.leadPublished", {
    bridgeUrl,
    phoneCount: lead.phones?.length || 0
  });

  return response.json();
}

async function openMatchingSalebaseScript(requestType, leadKey = '') {
  const option = salebaseOptionForRequestType(requestType);
  if (!option) return;
  pendingSalebaseOption = option;
  const tabs = await findSalebaseScriptTabs(chrome);
  if (tabs.length) {
    await Promise.all(tabs.map((tab) => selectSalebaseScript(tab.id, option)));
    return;
  }

  // The same lead is re-published often (every 30 seconds, and whenever the
  // IMPACT tab becomes visible again, e.g. after a rebuttal focused Salebase).
  // Only try to open a script window once per lead so re-publishing can never
  // keep adding Salebase tabs.
  const openKey = `${leadKey}|${option}`;
  if (openKey === lastSalebaseOpenKey) return;
  lastSalebaseOpenKey = openKey;
  const saved = await chrome.storage.session.get('impact.salebaseOpenKey').catch(() => ({}));
  if (saved['impact.salebaseOpenKey'] === openKey) return; // Survives a service-worker restart.
  await chrome.storage.session.set({ 'impact.salebaseOpenKey': openKey }).catch(() => {});

  // Salebase opens Phone Scripts in its own window from the dashboard. Use
  // that control when available so the rep sees the same script window they
  // would open themselves. The tabs.onUpdated listener above applies the
  // selected script as soon as that window finishes loading.
  const before = new Set((await findSalebaseTabs(chrome)).map((tab) => tab.id));
  const dashboards = await chrome.tabs.query({ url: 'https://salebase.ai/dashboard/*' });
  const [dashboard] = dashboards.filter((tab) => tab.id);
  if (dashboard?.id && await clickSalebaseCallLink(dashboard.id)) {
    // A slow popup or a browser that blocks the dashboard's window.open
    // falls back to the script page without delaying the IMPACT workflow.
    setTimeout(() => { void openSalebaseFallback(option, before); }, 1800);
    return;
  }
  await openSalebaseFallback(option, before);
}

async function clickSalebaseCallLink(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const link = document.querySelector('#callLink');
        if (!(link instanceof HTMLAnchorElement)) return false;
        link.click();
        return true;
      }
    });
    return result === true;
  } catch (_error) {
    return false;
  }
}

async function openSalebaseFallback(option, before = new Set()) {
  const tabs = await findSalebaseScriptTabs(chrome);
  if (tabs.length) {
    await Promise.all(tabs.map((tab) => selectSalebaseScript(tab.id, option)));
    return;
  }
  // If the dashboard's Call link already opened a Salebase window (even at a
  // URL we do not recognise), use it instead of adding another tab.
  const opened = (await findSalebaseTabs(chrome)).filter((tab) => !before.has(tab.id));
  if (opened.length) {
    await Promise.all(opened.map((tab) => selectSalebaseScript(tab.id, option)));
    return;
  }
  await chrome.tabs.create({ url: SALEBASE_SCRIPTS_URL, active: false });
}

async function selectSalebaseScript(tabId, option) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (wanted) => {
        const dropdown = document.querySelector('#myDropdown');
        if (!(dropdown instanceof HTMLSelectElement)) return false;
        const match = Array.from(dropdown.options).find((item) => item.text.trim().toLowerCase() === wanted.toLowerCase());
        if (!match || dropdown.value === match.value) return Boolean(match);
        dropdown.value = match.value;
        dropdown.dispatchEvent(new Event('input', { bubbles: true }));
        dropdown.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      args: [option]
    });
  } catch (_error) {
    // The tab may still be signing in or loading. The completed-load listener
    // above retries without interrupting the rep's IMPACT workflow.
  }
}

function makeLeadFingerprint(lead) {
  return JSON.stringify({
    leadName: lead?.leadName || "",
    leadId: lead?.leadId || "",
    requestType: lead?.requestType || "",
    callHistory: lead?.callHistory || [],
    language: lead?.language || "",
    email: lead?.email || "",
    address: lead?.address || "",
    phones: lead?.phones || [],
    quietHoursNoticeAt: lead?.quietHoursNoticeAt || "",
    nextLeadAvailable: Boolean(lead?.nextLead?.available),
    nextLeadName: lead?.nextLead?.leadName || "",
    nextLeadRequestType: lead?.nextLead?.requestType || "",
    nextLeadError: lead?.nextLead?.error || "",
    nextLeadCandidate: lead?.nextLead?.candidate?.safePath || ""
  });
}

async function appendLocalLog(level, event, details) {
  await appendLog({ level, event, details }, {});
}

async function appendLog(entry, sender) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.logs);
  const logs = result[STORAGE_KEYS.logs] || [];
  const nextEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level: entry?.level || "info",
    event: entry?.event || "unknown",
    tabId: sender?.tab?.id ?? null,
    url: scrubUrl(sender?.tab?.url ?? entry?.url ?? null),
    details: scrubValue(entry?.details || {})
  };

  logs.push(nextEntry);
  const trimmed = logs.slice(Math.max(0, logs.length - LOG_LIMIT));
  await chrome.storage.local.set({ [STORAGE_KEYS.logs]: trimmed });
}

function scrubLogEntry(entry) {
  return scrubValue({
    ...entry,
    url: scrubUrl(entry?.url)
  });
}

function scrubUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch (_error) {
    return null;
  }
}

function scrubValue(value) {
  if (typeof value === "string") {
    return scrubText(value);
  }

  if (Array.isArray(value)) {
    return value.map(scrubValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [key, scrubValue(childValue)])
    );
  }

  return value;
}

function scrubText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[phone]")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, "[zip]")
    .replace(/\bLeadId=\d+\b/g, "LeadId=[redacted]")
    .replace(/\bCheckIn[A-Za-z]+\(\d+/g, "CheckInAction([redacted]");
}
