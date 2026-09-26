import { LOG_LIMIT, STORAGE_KEYS } from "../shared/storage-keys.js";
import { parseBridgeUrl } from "../shared/bridge-config.js";
import { accessToken, client } from "../shared/auth-runtime.js";
import { cloudEnabled } from '../shared/cloud-sync.js';
import { publishCloud, takeCloudCommand, reportCloudResult, cloudLeadId } from './cloud-desktop.js';
import { publisherDecision, createLatestWinsQueue, followLeadChange, verifyPhoneLead, LEAD_CHANGING_COMMANDS } from './phone-sync.js';
import { SALEBASE_SCRIPTS_URL, scriptChoiceForLead, matchScriptOption, readScriptDropdown, applyScriptOption } from './salebase-scripts.js';
import { createObjectionDetector, REBUTTAL_LABELS } from './objection-matcher.js';
import { findSalebaseTabs, findSalebaseScriptTabs, isSalebaseScriptUrl, revealRebuttalInScriptTab } from './salebase-rebuttal.js';
import { scriptFieldsFromLead } from './script-fields.js';

const SCRIPT_LEAD_KEY = 'impact.scriptLead';
const SCRIPT_FILL_CONTENT_SCRIPT = 'src/content/salebase-personalize.js';
const IMPACT_LEAD_PAGE = /^https:\/\/mobile\.impact\.ailife\.com\/Lead\/(InboxDetail|WhatHappend|SetAppointment)(?:[?#]|$)/;

let lastAutoPublishFingerprint = "";
let lastAutoPublishAt = 0;
let lastPublishedLead = null;
let pendingSalebaseChoice = null; // { label, rule, requestType, leadKey } for a script tab still loading
let lastScriptGroup = { leadKey: '', group: '' }; // browser-only, from the IMPACT page
let lastScriptSelectKey = '';
let lastSalebaseOpenKey = '';
let objectionListening = false;
// Lead writes to the phone run one at a time; an older lead never lands last.
const leadWrites = createLatestWinsQueue();
let latestLeadId = '';      // the newest lead IMPACT has shown (what the phone should have)
let lastWrittenLeadId = '';
let followGeneration = 0;
let lastPublishSkip = '';
// One detected objection opens its rebuttal once, not on every repeat.
const objectionDetector = createObjectionDetector();
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' && isSalebaseScriptUrl(tab.url) && pendingSalebaseChoice?.label) {
    void selectSalebaseScript(tabId, pendingSalebaseChoice);
  }
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes['impact.supabase.session']) {
    lastAutoPublishFingerprint = '';
    lastPublishedLead = null;
    void chrome.storage.local.remove([STORAGE_KEYS.lastSnapshot, STORAGE_KEYS.inboxQueue]);
    if (!changes['impact.supabase.session'].newValue) void clearScriptLead();
  }
});
// The Salebase script shows the lead only while its IMPACT lead page is open.
chrome.tabs.onRemoved.addListener((tabId) => { void clearScriptLeadForTab(tabId); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url && !IMPACT_LEAD_PAGE.test(change.url)) void clearScriptLeadForTab(tabId);
});
// Salebase tabs that were already open before an install/update get the
// script-fill content script too (the manifest only covers new page loads).
chrome.runtime.onInstalled.addListener(() => { void injectScriptFill(); });
// The Salebase content script reads the lead fields from session storage (kept
// in memory, cleared when the browser closes). It never listens for tab
// messages, so the rebuttal messaging in the same tab is unaffected.
const allowScriptLeadInContentScripts = () => chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
void allowScriptLeadInContentScripts();

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
  if (message?.type === 'impact/getScriptLead') {
    Promise.resolve(allowScriptLeadInContentScripts()).then(readScriptLead).then((record) => sendResponse({ ok: true, fields: record?.fields || null })).catch(() => sendResponse({ ok: false, fields: null }));
    return true;
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
    // "Sync phone": always writes, whatever was sent before.
    publishLead(message.lead, { force: true, eventName: 'phoneSync.manualSync' })
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
    objectionListening = false;
    await chrome.storage.local.set({ 'impact.objectionListening': false, 'impact.objectionListenerError': '' });
    try { await chrome.runtime.sendMessage({ type: 'impact/offscreenSetObjectionListening', enabled: false }); } catch (_error) {}
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
  const taken = await takePhoneCommand();
  const command = taken?.command;
  // After a result or Previous/Next, follow IMPACT to the lead it moves to.
  if (command?.type && LEAD_CHANGING_COMMANDS.includes(command.type)) {
    void followAfterCommand(senderTab.id, command.leadId || latestLeadId);
  }
  return taken;
}

async function takePhoneCommand() {
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
  const skip = await publishSkipReason(senderTab);
  if (skip || !/^https:\/\/mobile\.impact\.ailife\.com\/Lead\/SetAppointment(?:[?#]|$)/.test(senderTab?.url || "")) {
    return { skipped: true, reason: skip || "not the appointment page" };
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

async function autoPublishLead(incoming, senderTab) {
  // Script-only details (DOB, group, ...) stay in this browser: they fill the
  // Salebase script and are never sent to the phone, bridge or cloud.
  const { scriptDetails, ...lead } = incoming || {};
  const skip = await publishSkipReason(senderTab);
  if (skip) return { skipped: true, reason: skip };
  noteScriptGroup(lead, scriptDetails);
  await rememberScriptLead(lead, scriptDetails, senderTab.id).catch(() => {});
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

// Every lead write goes through here, in order (see createLatestWinsQueue).
// force: skip nothing (Sync phone, follow-after-command and resync).
function publishLead(lead, options = {}) {
  if (!lead?.available) {
    return Promise.reject(new Error("No lead payload available to send."));
  }
  if (lead.leadId) latestLeadId = lead.leadId;
  return leadWrites.run((seq) => writeLead(lead, seq, options), { mustRun: Boolean(options.force) });
}

async function writeLead(lead, seq, options = {}) {
  lastPublishedLead = structuredClone(lead);
  // Every lead write (auto, follow-after-result, resync, Sync phone) checks the script.
  void openMatchingSalebaseScript(lead);
  const leadChanged = Boolean(lead.leadId) && lead.leadId !== lastWrittenLeadId;
  let written;
  try {
    written = await sendLeadToPhone(lead, options);
  } catch (error) {
    await appendLocalLog('warn', 'phoneSync.publishFailed', { reason: error.message, leadChanged, via: options.eventName || 'auto' });
    throw error;
  }
  if (leadChanged || options.force) {
    await appendLocalLog('info', 'phoneSync.published', { leadChanged, via: options.eventName || 'auto', seq, hasName: Boolean(lead.leadName), phoneCount: lead.phones?.length || 0 });
  }
  if (leadChanged) {
    lastWrittenLeadId = lead.leadId;
    // Belt and braces: read back what the phone sees; resync if it differs.
    void checkPhoneHasLead(lead.leadId);
  }
  return written;
}

async function sendLeadToPhone(lead, options = {}) {
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

// The group (e.g. "IUOE 148 (SGK2Q)") only helps choose the script; it stays in this browser.
function noteScriptGroup(lead, details) {
  const leadKey = lead?.leadId || lead?.leadName || '';
  if (leadKey) lastScriptGroup = { leadKey, group: String(details?.group || '') };
}

async function openMatchingSalebaseScript(lead) {
  const requestType = String(lead?.requestType || '');
  const leadKey = lead?.leadId || lead?.leadName || '';
  const group = lastScriptGroup.leadKey === leadKey ? lastScriptGroup.group : '';
  const choice = scriptChoiceForLead(requestType, { group });
  const request = { label: choice.label, rule: choice.rule, requestType, leadKey };
  pendingSalebaseChoice = request;
  const option = choice.label;
  const tabs = await findSalebaseScriptTabs(chrome).catch(() => []);
  if (!option) {
    await reportScriptSelect(request, { status: 'no-mapping', reason: choice.rule });
    return;
  }
  if (tabs.length) {
    // Runs on every write, so a lead change always re-checks the dropdown
    // (nothing changes when the right script is already selected).
    await Promise.all(tabs.map((tab) => selectSalebaseScript(tab.id, request)));
    return;
  }

  // The same lead is re-published often (every 30 seconds, and whenever the
  // IMPACT tab becomes visible again, e.g. after a rebuttal focused Salebase).
  // Only try to open a script window once per lead so re-publishing can never
  // keep adding Salebase tabs.
  const openKey = `${leadKey}|${option}`;
  if (openKey === lastSalebaseOpenKey) return;
  lastSalebaseOpenKey = openKey;
  await reportScriptSelect(request, { status: 'no-script-window', reason: 'opening the Salebase script window' });
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
    setTimeout(() => { void openSalebaseFallback(request, before); }, 1800);
    return;
  }
  await openSalebaseFallback(request, before);
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

async function openSalebaseFallback(request, before = new Set()) {
  const tabs = await findSalebaseScriptTabs(chrome);
  if (tabs.length) {
    await Promise.all(tabs.map((tab) => selectSalebaseScript(tab.id, request)));
    return;
  }
  // If the dashboard's Call link already opened a Salebase window (even at a
  // URL we do not recognise), use it instead of adding another tab.
  const opened = (await findSalebaseTabs(chrome)).filter((tab) => !before.has(tab.id));
  if (opened.length) {
    await Promise.all(opened.map((tab) => selectSalebaseScript(tab.id, request)));
    return;
  }
  await chrome.tabs.create({ url: SALEBASE_SCRIPTS_URL, active: false });
}

// Reads the script dropdown, picks the option for this lead (see
// matchScriptOption) and selects it the way a click would. Every outcome is
// logged as salebase.scriptSelect and shown in the popup's Script line.
async function selectSalebaseScript(tabId, request) {
  let page = null;
  try {
    [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId }, func: readScriptDropdown });
  } catch (error) {
    // Still signing in or loading: the completed-load listener above retries.
    await reportScriptSelect(request, { status: 'tab-not-ready', reason: error.message });
    return;
  }
  if (!page?.found) {
    await reportScriptSelect(request, { status: 'no-dropdown', reason: 'no #myDropdown with options on the Salebase page' });
    return;
  }
  const options = page.options || [];
  const match = matchScriptOption(request.label, options, request.requestType);
  const base = { options, selectedBefore: options[page.selectedIndex] ?? '' };
  if (match.index < 0) {
    await reportScriptSelect(request, { ...base, status: match.how === 'ambiguous' ? 'ambiguous' : 'no-match', reason: match.reason });
    return;
  }
  if (page.selectedIndex === match.index) {
    await reportScriptSelect(request, { ...base, status: 'already-selected', chosen: match.text, how: match.how });
    return;
  }
  let applied = null;
  try {
    [{ result: applied }] = await chrome.scripting.executeScript({ target: { tabId }, func: applyScriptOption, args: [match.index, match.text] });
  } catch (error) {
    applied = { ok: false, reason: error.message };
  }
  await reportScriptSelect(request, { ...base, status: applied?.ok ? 'selected' : 'select-failed', chosen: match.text, how: match.how, reason: applied?.reason || '' });
}

async function reportScriptSelect(request, outcome) {
  const entry = {
    requestType: request?.requestType || '', rule: request?.rule || '', label: request?.label || '',
    status: outcome.status, chosen: String(outcome.chosen || '').trim(), how: outcome.how || '',
    reason: outcome.reason || '', selectedBefore: String(outcome.selectedBefore || '').trim(),
    options: (outcome.options || []).map((text) => String(text).replace(/\s+/g, ' ').trim()).slice(0, 40)
  };
  // The same lead is re-published every 30 seconds: log each distinct outcome once.
  const key = JSON.stringify([request?.leadKey || '', entry.label, entry.status, entry.chosen, entry.options]);
  if (key === lastScriptSelectKey) return;
  lastScriptSelectKey = key;
  const ok = ['selected', 'already-selected'].includes(entry.status);
  await appendLocalLog(ok || entry.status === 'no-script-window' ? 'info' : 'warn', 'salebase.scriptSelect', entry);
  await chrome.storage.session.set({ 'impact.scriptSelect': { ...entry, at: Date.now() } }).catch(() => {});
}

// ---- Keeping the phone on IMPACT's lead ----
async function publishSkipReason(senderTab) {
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const reason = publisherDecision(senderTab, focused);
  if (reason && reason !== lastPublishSkip) await appendLocalLog('info', 'phoneSync.publishSkipped', { reason });
  lastPublishSkip = reason;
  return reason;
}

async function readPhoneLeadId() {
  if (await cloudEnabled()) return cloudLeadId();
  const settings = await chrome.storage.local.get([STORAGE_KEYS.bridgeUrl, STORAGE_KEYS.bridgeToken]);
  const bridgeUrl = parseBridgeUrl(settings[STORAGE_KEYS.bridgeUrl]).replace(/\/$/, '');
  const response = await fetch(`${bridgeUrl}/api/current-lead?token=${encodeURIComponent(settings[STORAGE_KEYS.bridgeToken] || '')}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(8000), cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload.lead?.leadId || '';
}

function checkPhoneHasLead(leadId) {
  return verifyPhoneLead({
    expectedLeadId: leadId,
    currentLeadId: () => latestLeadId,
    readPhoneLeadId,
    republish: () => (lastPublishedLead?.leadId === leadId ? publishLead(lastPublishedLead, { force: true, eventName: 'phoneSync.resync' }) : Promise.resolve()),
    log: appendLocalLog
  }).catch(() => {});
}

async function followAfterCommand(tabId, fromLeadId) {
  const generation = ++followGeneration;
  await followLeadChange({
    fromLeadId,
    isCurrent: () => generation === followGeneration,
    readLead: async () => {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'impact/readCurrentLead' });
      if (!response?.lead?.available) return null;
      const { scriptDetails, ...lead } = response.lead;
      noteScriptGroup(lead, scriptDetails);
      await rememberScriptLead(lead, scriptDetails, tabId).catch(() => {});
      return lead;
    },
    publish: (lead) => publishLead(lead, { force: true, eventName: 'phoneSync.followPublished' }).catch(() => {}),
    verify: async () => {}, // writeLead already checks the phone when the lead changes
    log: appendLocalLog
  }).catch(() => {});
}

// ---- Lead details for the Salebase phone script ----
async function readScriptLead() {
  const stored = await chrome.storage.session.get(SCRIPT_LEAD_KEY).catch(() => ({}));
  return stored[SCRIPT_LEAD_KEY] || null;
}

async function rememberScriptLead(lead, details, sourceTabId) {
  if (!lead?.available || !lead.leadName) return;
  let user = null;
  try { user = (await client.auth.getSession()).data?.session?.user || null; } catch (_error) {}
  const fields = scriptFieldsFromLead(lead, details || {}, user);
  if (!fields) return;
  const previous = await readScriptLead();
  if (previous && previous.sourceTabId === sourceTabId && JSON.stringify(previous.fields) === JSON.stringify(fields)) return;
  await chrome.storage.session.set({ [SCRIPT_LEAD_KEY]: { fields, sourceTabId, at: Date.now() } });
}

async function clearScriptLeadForTab(tabId) {
  const record = await readScriptLead();
  if (record && record.sourceTabId === tabId) await clearScriptLead();
}

async function clearScriptLead() {
  await chrome.storage.session.remove(SCRIPT_LEAD_KEY).catch(() => {});
}

async function injectScriptFill() {
  const tabs = await findSalebaseScriptTabs(chrome).catch(() => []);
  await Promise.all(tabs.map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [SCRIPT_FILL_CONTENT_SCRIPT] }).catch(() => {})));
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
