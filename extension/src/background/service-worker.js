import { planImportMessage } from './plan-import.js';
import { LOG_LIMIT, STORAGE_KEYS } from "../shared/storage-keys.js";
import { parseBridgeUrl } from "../shared/bridge-config.js";
import { accessToken, client } from "../shared/auth-runtime.js";
import { cloudEnabled } from '../shared/cloud-sync.js';
import { publishCloud, takeCloudCommand, reportCloudResult, cloudLeadId, clearCloudSlot } from './cloud-desktop.js';
import { publisherDecision, claimWindowSlot, assignWindowSlot, createLatestWinsQueue, followLeadChange, verifyPhoneLead, LEAD_CHANGING_COMMANDS } from './phone-sync.js';
import { SALEBASE_SCRIPTS_URL, scriptChoiceForLead, matchScriptOption, readScriptDropdown, applyScriptOption } from './salebase-scripts.js';
import { createObjectionDetector, REBUTTAL_LABELS } from './objection-matcher.js';
import { findSalebaseTabs, findSalebaseScriptTabs, isSalebaseScriptUrl, revealRebuttalInScriptTab, messageRebuttalScript } from './salebase-rebuttal.js';
import { scriptFieldsFromLead } from './script-fields.js';
import { callingHoursOpen } from '../shared/work-hours.js';
import { dueReminders } from '../shared/appointment-reminders.js';

const SCRIPT_LEADS_KEY = 'impact.scriptLeads';
const SCRIPT_TAB_SLOTS_KEY = 'impact.salebaseScriptSlots';
const SCRIPT_FILL_CONTENT_SCRIPT = 'src/content/salebase-personalize.js';
const CALM_SCRIPT_CONTENT_SCRIPT = 'src/content/salebase-calm.js';
const IMPACT_LEAD_PAGE = /^https:\/\/mobile\.impact\.ailife\.com\/Lead\/(InboxDetail|WhatHappend|SetAppointment)(?:[?#]|$)/;

let lastAutoPublishFingerprint = "";
let lastAutoPublishAt = 0;
const pendingSalebaseChoices = new Map(); // slot -> { label, rule, requestType, leadKey }
const scriptGroupsByLead = new Map(); // lead key -> group, browser-only
const laneScriptFields = new Map(); // phone slot -> fields for its own script tab
const lastScriptSelectKeys = new Map();
const lastSalebaseOpenKeys = new Map();
const scriptSelectionRetries = new Map();
let objectionListening = false;
// Lead writes to the phone run one at a time; an older lead never lands last.
const slotQueues = new Map();
const slotMemory = new Map();
function queueFor(slot) {
  const key = slot === '2' ? '2' : '1';
  if (!slotQueues.has(key)) slotQueues.set(key, createLatestWinsQueue());
  return slotQueues.get(key);
}
let lastWrittenLeadId = '';
const followGenerations = new Map();
let lastPublishSkip = '';
// One detected objection opens its rebuttal once, not on every repeat.
const objectionDetector = createObjectionDetector();
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' && isSalebaseScriptUrl(tab.url)) {
    void scriptSlotForTab(tabId).then((slot) => {
      if (slot) void syncScriptLeadForLane(slot);
      const request = pendingSalebaseChoices.get(slot);
      if (request?.label) void selectSalebaseScript(tabId, request, slot);
    });
  }
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes['impact.supabase.session']) {
    lastAutoPublishFingerprint = '';
    void chrome.storage.local.remove([STORAGE_KEYS.lastSnapshot, STORAGE_KEYS.inboxQueue]);
    if (!changes['impact.supabase.session'].newValue) void clearScriptLead();
  }
});
// The Salebase script shows the lead only while its IMPACT lead page is open.
chrome.tabs.onRemoved.addListener((tabId) => { void clearScriptLeadForTab(tabId); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  // A Salebase script also changes URL while it is loading. Only an IMPACT
  // lead tab navigating away should release its lane’s lead data.
  if (change.url && !IMPACT_LEAD_PAGE.test(change.url)) void clearImpactScriptLeadForTab(tabId);
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
  if (['impact/planStatus','impact/planImport','impact/callingList'].includes(message?.type)) {
    planImportMessage(message,sender).then(sendResponse).catch(error=>sendResponse({ok:false,error:error?.message||'Import failed while contacting your saved plan. Check your internet connection and Companion sign-in, then retry.'}));return true;
  }
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
    Promise.resolve(allowScriptLeadInContentScripts()).then(async () => {
      let slot = await scriptSlotForTab(sender.tab?.id);
      const marker = String(sender.tab?.url || "").match(/[#&]impact-phone=([12])(?:&|$)/)?.[1];
      if (marker && marker !== slot) {
        slot = marker;
        const map = await scriptSlotMap();
        map[String(sender.tab.id)] = slot;
        await writeScriptSlotMap(map);
      }
      if (slot) await refreshScriptLane(slot).catch(error => { void appendLocalLog("warn", "salebase.scriptRefresh", {slot,reason:error.message}); });
      const saved = await readScriptLead(sender.tab?.id);
      const record = saved?.slot === slot ? saved : null;
      return { fields: record?.fields || laneScriptFields.get(slot)?.fields || null, slot: record?.slot || slot || '', scriptType: record?.scriptType || pendingSalebaseChoices.get(slot)?.label || '' };
    }).then((result) => sendResponse({ ok: true, ...result })).catch(() => sendResponse({ ok: false, fields: null, slot: '' }));
    return true;
  }
  if (message?.type === 'impact/reopenPhoneScripts') {
    reopenPhoneScripts().then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'impact/openPhoneScriptWindow') {
    openPhoneScriptWindow(message.slot).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }));
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

  if (message?.type === 'impact/windowSlot') {
    slotForTab(sender.tab).then((slot) => sendResponse({ ok: true, slot })).catch(() => sendResponse({ ok: false, slot: '' }));
    return true;
  }
  if (message?.type === 'impact/setWindowSlot') {
    setTabSlot(sender.tab, message.slot).then((slot) => sendResponse({ ok: true, slot })).catch(() => sendResponse({ ok: false, slot: '' }));
    return true;
  }

  if (message?.type === "impact/publishLead") {
    // "Sync phone": always writes, whatever was sent before.
    slotForTab(sender.tab).then((slot) => {
      if (!slot) throw new Error('This IMPACT tab is not assigned to a phone. Select Phone 1 or Phone 2 first.');
      return publishLead(message.lead, { force: true, eventName: 'phoneSync.manualSync', slot });
    })
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

  if (message?.type === 'impact/getBestNextScores') {
    requestTypeScores().then((scores) => sendResponse({ ok: true, scores })).catch(() => sendResponse({ ok: true, scores: {} }));
    return true;
  }

  if (message?.type === "impact/commandResult") {
    slotForTab(sender.tab).then((slot) => slot ? reportCommandResult(message.message, slot) : undefined)
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
  void refreshRebuttalTitles();
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

// Rebuttal titles on the rep's Salebase page, so a rebuttal Cody adds there
// later is still matched (loosely, from its title words) before the built-in
// list learns it. Refreshed when listening starts, after each rebuttal, and
// when older than two minutes.
const REBUTTAL_TITLES_MAX_AGE_MS = 2 * 60 * 1000;
let pageRebuttalTitles = { at: 0, titles: [] };
let rebuttalTitlesLoading = null;
function refreshRebuttalTitles() {
  if (rebuttalTitlesLoading) return rebuttalTitlesLoading;
  rebuttalTitlesLoading = (async () => {
    try {
      const tabs = await findSalebaseScriptTabs(chrome).catch(() => []);
      const tab = tabs.find((item) => item.active && !item.discarded) || tabs.find((item) => !item.discarded);
      if (!tab) return;
      const listing = await messageRebuttalScript(chrome, tab.id, { type: 'impact/listRebuttals' });
      if (Array.isArray(listing?.rebuttals)) pageRebuttalTitles = { at: Date.now(), titles: [...new Set(listing.rebuttals.map((item) => item.title).filter(Boolean))] };
    } catch (_error) { /* keep the last list */ } finally { rebuttalTitlesLoading = null; }
  })();
  return rebuttalTitlesLoading;
}

async function handleObjectionTranscript(transcript) {
  // Optional extra phrases per objection id, e.g.
  // { "forgot": ["that was my late husband"] }, merged with the built-in ones.
  // Nothing here stores the transcript: only labels, scores and outcomes.
  let detection;
  try {
    const stored = await chrome.storage.local.get('impact.objectionPhrases').catch(() => ({}));
    if (Date.now() - pageRebuttalTitles.at > REBUTTAL_TITLES_MAX_AGE_MS) void refreshRebuttalTitles();
    detection = objectionDetector.detect(transcript, Date.now(), { customPhrases: stored['impact.objectionPhrases'], extraTitles: pageRebuttalTitles.titles });
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
  await chrome.storage.local.set({ 'impact.lastObjection': { label: match.label, titles: match.titles || [match.label], at: Date.now(), status: 'looking', stage: 'matched', score: match.score, via: match.via } });
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
  // label = the Salebase title actually opened (or borrowed from another script).
  const shownLabel = result.label || match.label;
  await chrome.storage.local.set({
    'impact.lastObjection': { label: shownLabel, objection: match.label, titles: match.titles || [match.label], at: Date.now(), status: result.status, stage: result.stage || '', action: result.action || '', message: result.message, score: match.score, via: match.via, fromScript: result.fromScript || '', activeScript: result.activeScript || '' }
  });
  void refreshRebuttalTitles();
  await appendLocalLog(result.status === 'opened' ? 'info' : 'warn', 'salebase.rebuttal', {
    label: shownLabel,
    objection: match.id,
    status: result.status,
    // other-script: the selected script has no such rebuttal; the calm view
    // shows the text from fromScript instead. not-in-script: nothing shown.
    activeScript: result.activeScript || '',
    fromScript: result.fromScript || '',
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
    return { command: null, slot: '' };
  }
  const slot = await slotForTab(senderTab);
  if (!slot) return { command: null, slot: '' };
  const taken = await takePhoneCommand(slot);
  const command = taken?.command;
  if (command?.type === 'best-next') {
    // Only aggregate outcome counts leave Supabase here. The browser matches
    // those scores to the current Inbox locally; customer details stay in IMPACT.
    command.requestTypeScores = await requestTypeScores().catch(() => ({}));
  }
  // After a result or Previous/Next, follow IMPACT to the lead it moves to.
  if (command?.type && LEAD_CHANGING_COMMANDS.includes(command.type)) {
    // Keep the follow-up tied to this phone's own IMPACT tab. Never borrow a
    // recently published lead from the other phone's lane.
    void followAfterCommand(senderTab.id, command.leadId || slotMemory.get(slot)?.leadId || '', slot);
  }
  return { ...taken, slot };
}

function centralHour(now = new Date()) {
  const value = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now).find((part) => part.type === 'hour')?.value;
  return Number(value) % 24;
}

function outcomePoints(outcome) {
  if (outcome === 'held') return 4;
  if (outcome === 'virtual-appointment') return 3;
  if (outcome === 'refused-appointment') return -2;
  if (outcome === 'no-show') return -3;
  if (outcome === 'rescheduled' || outcome === 'no-answer') return -1;
  return 0;
}

function chicagoWeekday(now = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(now);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

// A slice of results only moves the score once it has at least four calls,
// and only by how much it beats or trails that type's usual result.
function sliceLift(rows, overall) {
  if (!rows || rows.length < 4) return 0;
  const rate = rows.reduce((sum, row) => sum + outcomePoints(row.outcome), 0) / rows.length;
  return Math.max(-0.6, Math.min(0.6, rate - overall));
}

function scoreRequestTypes(rows, hour, options = {}) {
  const grouped = new Map();
  const add = (row) => {
    const type = String(row?.request_type || '').trim().toLowerCase();
    if (!type) return;
    const list = grouped.get(type) || [];
    list.push(row);
    grouped.set(type, list);
  };
  for (const row of rows || []) add(row);
  for (const show of options.showUps || []) add({ request_type: show.request_type, outcome: show.status, created_at: show.created_at, showUp: true });
  const scores = {};
  for (const [type, list] of grouped) {
    let good = 0;
    let attempts = 0;
    for (const row of list) {
      const weight = !row.showUp && Number(row.local_hour) === hour ? 2 : 1;
      attempts += weight;
      good += outcomePoints(row.outcome) * weight;
    }
    const overall = good / Math.max(1, attempts);
    const hourRows = list.filter((row) => !row.showUp && Math.abs(Number(row.local_hour) - hour) <= 1);
    const dayRows = Number.isInteger(options.weekday) ? list.filter((row) => row.created_at && chicagoWeekday(new Date(row.created_at)) === options.weekday) : [];
    scores[type] = Math.round((overall + sliceLift(hourRows, overall) + sliceLift(dayRows, overall)) * 100) / 100;
  }
  return scores;
}

async function requestTypeScores() {
  const since = new Date(Date.now() - 180 * 86400000).toISOString();
  const calls = await client.from('companion_call_outcomes')
    .select('outcome,request_type,local_hour,created_at')
    .gte('created_at', since)
    .limit(10000);
  if (calls.error || !Array.isArray(calls.data)) return {};
  let showUps = [];
  const [outcomes, events] = await Promise.all([
    client.from('appointment_outcomes').select('status,scheduled_event_id,created_at').gte('created_at', since).limit(5000),
    client.from('scheduled_events').select('id,request_type').limit(5000)
  ]);
  if (!outcomes.error && !events.error) {
    const types = new Map((events.data || []).map((row) => [row.id, row.request_type]));
    showUps = (outcomes.data || []).map((row) => ({ status: row.status, request_type: types.get(row.scheduled_event_id) || '', created_at: row.created_at }));
  }
  return scoreRequestTypes(calls.data, centralHour(), { showUps, weekday: chicagoWeekday() });
}

async function takePhoneCommand(slot = '1') {
  if (await cloudEnabled()) return takeCloudCommand(slot);
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
  const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/api/command/next?token=${encodeURIComponent(bridgeToken)}&slot=${encodeURIComponent(slot)}`, {
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
  const slot = await slotForTab(senderTab);
  const skip = await publishSkipReason(senderTab);
  if (skip || !slot || !/^https:\/\/mobile\.impact\.ailife\.com\/Lead\/SetAppointment(?:[?#]|$)/.test(senderTab?.url || "")) {
    return { skipped: true, reason: skip || !slot ? "only two phone windows" : "not the appointment page" };
  }
  // Appointment choices must belong to this slot. A global "last lead"
  // fallback can accidentally send Phone 1's lead to Phone 2.
  const current = slotMemory.get(slot)?.lead;
  if (!current?.available || !appointmentOptions?.leadId || appointmentOptions.leadId !== current.leadId) {
    throw new Error("Appointment options do not match the current lead.");
  }
  return publishLead({ ...current, appointmentOptions }, { eventName: "cloud.appointmentOptionsPublished", slot });
}

async function reportCommandResult(message, slot = "1") {
  const phone = slot === "2" ? "2" : "1";
  if (await cloudEnabled()) return reportCloudResult(message, phone);
  const settings = await chrome.storage.local.get([STORAGE_KEYS.bridgeUrl, STORAGE_KEYS.bridgeToken]);
  const response = await fetch(`${parseBridgeUrl(settings[STORAGE_KEYS.bridgeUrl])}/api/command/result`, {
    method: "POST", signal: AbortSignal.timeout(8000),
    headers: { "content-type": "application/json", "x-bridge-token": settings[STORAGE_KEYS.bridgeToken] || "", Authorization: `Bearer ${await accessToken()}` },
    body: JSON.stringify({ message, slot: phone })
  });
  if (!response.ok) throw new Error("Could not report command result.");
}

async function autoPublishLead(incoming, senderTab) {
  // Script-only details (DOB, group, ...) stay in this browser: they fill the
  // Salebase script and are never sent to the phone, bridge or cloud.
  const { scriptDetails, ...lead } = incoming || {};
  const slot = await slotForTab(senderTab);
  if (!slot) return { skipped: true, reason: 'only two phone windows' };
  const skip = await publishSkipReason(senderTab);
  if (skip) return { skipped: true, reason: skip };
  noteScriptGroup(lead, scriptDetails);
  await rememberScriptLead(lead, scriptDetails, senderTab.id, slot).catch(() => {});
  await openMatchingSalebaseScript(lead, slot);
  const result = await chrome.storage.local.get(STORAGE_KEYS.autoPublish);
  const autoPublish = result[STORAGE_KEYS.autoPublish] !== false;

  if (!autoPublish) {
    return { skipped: true, reason: "autoPublish disabled" };
  }

  const fingerprint = makeLeadFingerprint(lead);
  const bearer = await accessToken();
  const refreshAfter = await cloudEnabled() ? 30000 : 900000;
  const remembered = slotMemory.get(slot) || {};
  if (`${bearer}:${fingerprint}` === remembered.fingerprint && Date.now() - (remembered.at || 0) < refreshAfter) {
    return { skipped: true, reason: "duplicate lead payload" };
  }

  try {
    const result = await publishLead(lead, { eventName: "bridge.leadAutoPublished", slot });
    slotMemory.set(slot, { ...(slotMemory.get(slot) || {}), fingerprint: `${bearer}:${fingerprint}`, at: Date.now() });
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
  if (!callingHoursOpen()) {
    void client.auth.signOut({ scope: 'local' });
    return Promise.reject(new Error('Companion is closed until 9:00 AM in your time zone.'));
  }
  if (!lead?.available) {
    return Promise.reject(new Error("No lead payload available to send."));
  }
  const slot = options.slot === '2' ? '2' : '1';
  return queueFor(slot).run((seq) => writeLead(lead, seq, { ...options, slot }), { mustRun: Boolean(options.force) });
}

async function writeLead(lead, seq, options = {}) {
  const slot = options.slot === '2' ? '2' : '1';
  const laneLead = structuredClone(lead);
  slotMemory.set(slot, { ...(slotMemory.get(slot) || {}), lead: laneLead, leadId: lead.leadId || '' });
  // Every lead write (auto, follow-after-result, resync, Sync phone) checks the script.
  void openMatchingSalebaseScript(lead, slot);
  const leadChanged = Boolean(lead.leadId) && lead.leadId !== (slot === '1' ? lastWrittenLeadId : slotMemory.get(slot)?.writtenId);
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
    if (slot === '1') lastWrittenLeadId = lead.leadId;
    slotMemory.set(slot, { ...(slotMemory.get(slot) || {}), writtenId: lead.leadId });
    // Belt and braces: read back what the phone sees; resync if it differs.
    void checkPhoneHasLead(lead.leadId, slot);
  }
  return written;
}

async function sendLeadToPhone(lead, options = {}) {
  const slot = options.slot === '2' ? '2' : '1';
  if (await cloudEnabled()) return publishCloud(lead, slot);

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
      slot,
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
  if (leadKey) scriptGroupsByLead.set(leadKey, String(details?.group || ''));
}

function laneKey(slot) { return slot === '2' ? '2' : '1'; }
function twoPhoneLanesActive() { return Boolean(slotMemory.get('1')?.leadId && slotMemory.get('2')?.leadId); }

async function scriptSlotMap() {
  const stored = await chrome.storage.session.get(SCRIPT_TAB_SLOTS_KEY).catch(() => ({}));
  return stored[SCRIPT_TAB_SLOTS_KEY] || {};
}

async function writeScriptSlotMap(map) {
  await chrome.storage.session.set({ [SCRIPT_TAB_SLOTS_KEY]: map }).catch(() => {});
}

async function scriptSlotForTab(tabId) {
  const map = await scriptSlotMap();
  if (map[String(tabId)] === '1' || map[String(tabId)] === '2') return map[String(tabId)];
  const record = await readScriptLead(tabId);
  if (record?.slot === '1' || record?.slot === '2') {
    map[String(tabId)] = record.slot;
    await writeScriptSlotMap(map);
    return record.slot;
  }
  return '';
}

async function scriptTabForLane(slot, tabs) {
  const lane = laneKey(slot);
  const map = await scriptSlotMap();
  const live = new Set((tabs || []).map((tab) => String(tab.id)));
  for (const id of Object.keys(map)) if (!live.has(id)) delete map[id];
  const existingId = Object.entries(map).find(([, assigned]) => assigned === lane)?.[0];
  if (existingId) return (tabs || []).find((tab) => String(tab.id) === existingId) || null;
  const used = new Set(Object.keys(map));
  const available = (tabs || []).find((tab) => !used.has(String(tab.id)));
  if (available) {
    map[String(available.id)] = lane;
    await writeScriptSlotMap(map);
    return available;
  }
  return null;
}

async function bindScriptTab(tabId, slot) {
  const map = await scriptSlotMap();
  map[String(tabId)] = laneKey(slot);
  await writeScriptSlotMap(map);
  await syncScriptLeadForLane(slot);
  const request = pendingSalebaseChoices.get(laneKey(slot));
  if (request?.label) scheduleScriptSelectionRetry(tabId, request, slot, 1);
}

async function openMatchingSalebaseScript(lead, slot = '1', forceNewWindow = false) {
  const lane = laneKey(slot);
  const requestType = String(lead?.requestType || '');
  const leadKey = lead?.leadId || lead?.leadName || '';
  const group = scriptGroupsByLead.get(leadKey) || '';
  const choice = scriptChoiceForLead(requestType, { group });
  const request = { label: choice.label, rule: choice.rule, requestType, leadKey, slot: lane };
  pendingSalebaseChoices.set(lane, request);
  const option = choice.label;
  if (forceNewWindow) {
    const created = await chrome.windows.create({ url: SALEBASE_SCRIPTS_URL + "#impact-phone=" + lane, type: 'popup', focused: false, width: 1080, height: 900 });
    const tab = created?.tabs?.find((item) => item?.id);
    if (!tab?.id) throw new Error(`Could not open the Phone ${lane} script window.`);
    await bindScriptTab(tab.id, lane);
    return;
  }
  if (!option) {
    await reportScriptSelect(request, { status: 'no-mapping', reason: choice.rule });
    return;
  }
  const tabs = await findSalebaseScriptTabs(chrome).catch(() => []);
  const assigned = await scriptTabForLane(lane, tabs);
  if (assigned) {
    // Only this phone's script is changed and filled. The other lane keeps
    // its own person, script choice, and rebuttal view intact.
    await selectSalebaseScript(assigned.id, request, lane);
    await syncScriptLeadForLane(lane);
    return;
  }

  // A second script window is created only when both phone lanes are active.
  if (twoPhoneLanesActive()) {
    const created = await chrome.tabs.create({ url: SALEBASE_SCRIPTS_URL, active: false });
    if (created?.id) await bindScriptTab(created.id, lane);
    return;
  }

  // The same lead is re-published often (every 30 seconds, and whenever the
  // IMPACT tab becomes visible again, e.g. after a rebuttal focused Salebase).
  // Only try to open a script window once per lead so re-publishing can never
  // keep adding Salebase tabs.
  const openKey = `${leadKey}|${option}`;
  if (openKey === lastSalebaseOpenKeys.get(lane)) return;
  lastSalebaseOpenKeys.set(lane, openKey);
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

async function reopenPhoneScripts() {
  // Rebuild each lane independently. This also repairs stale tab ownership
  // left behind if the extension worker restarted while both IMPACT windows
  // stayed open.
  const impactTabs = await chrome.tabs.query({ url: 'https://mobile.impact.ailife.com/Lead/*' });

  const lanes = [];
  for (const lane of ['1', '2']) {
    try {
      await openPhoneScriptWindow(lane);
      lanes.push(lane);
    } catch (error) {
      // Phone 2 is optional. Phone 1 remains required when this is used from
      // the extension control, so surface that error instead of silently
      // opening the wrong script window.
      if (lane === '1') throw error;
    }
  }
  if (!lanes.length) throw new Error('Open an IMPACT lead first, then reopen its script.');
  return { lanes };
}

async function openPhoneScriptWindow(slot) {
  const lane = laneKey(slot);
  // Open in the button's workflow before any IMPACT reads or lead syncing.
  const created = await chrome.windows.create({ url: SALEBASE_SCRIPTS_URL + "#impact-phone=" + lane, type: 'popup', focused: true, width: 1080, height: 900 });
  const tab = created?.tabs?.find(item => item?.id);
  if (!tab?.id) throw new Error(`Could not open the Phone ${lane} script window.`);
  const map = await scriptSlotMap();
  // Replace this lane's old script assignment so subsequent fills reach this window.
  for (const id of Object.keys(map)) if (map[id] === lane) delete map[id];
  map[String(tab.id)] = lane;
  await writeScriptSlotMap(map);
  void (async () => {
    if (!laneScriptFields.has(lane)) {
      const stored = await chrome.storage.session.get(SCRIPT_LEADS_KEY);
      const record = Object.values(stored[SCRIPT_LEADS_KEY] || {}).filter(item => item?.slot === lane && item?.fields).sort((a,b) => (b.at || 0) - (a.at || 0))[0];
      if (record) laneScriptFields.set(lane, { fields: record.fields, sourceTabId: record.sourceTabId, at: record.at });
    }
    await syncScriptLeadForLane(lane);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await reopenPhoneScriptsForLane(lane, false)) return;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    await appendLocalLog('warn', 'salebase.scriptRecovery', { slot: lane, reason: 'IMPACT has not supplied a lead after four attempts' });
  })().catch(error => {
    void appendLocalLog('warn', 'salebase.scriptRecovery', { slot: lane, reason: error.message });
  });
  return { lane };
}

async function reopenPhoneScriptsForLane(lane, forceNewWindow = true) {
  const impactTabs = await chrome.tabs.query({ url: 'https://mobile.impact.ailife.com/Lead/*' });
  const tab = await impactTabForLane(impactTabs, lane);
  if (tab?.id) {
    const response = await Promise.race([chrome.tabs.sendMessage(tab.id, { type: 'impact/readCurrentLead' }).catch(() => null), new Promise(resolve => setTimeout(() => resolve(null), 4000))]);
    if (response?.lead?.available) {
      const { scriptDetails, ...lead } = response.lead;
      noteScriptGroup(lead, scriptDetails);
      slotMemory.set(lane, { ...(slotMemory.get(lane) || {}), lead, leadId: lead.leadId || '' });
      await rememberScriptLead(lead, scriptDetails, tab.id, lane);
      await openMatchingSalebaseScript(lead, lane, forceNewWindow);
      await publishLead(lead, { force: true, slot: lane, eventName: 'phoneSync.scriptRecovery' });
      return true;
    }
  }
  // Manual opening remains available from the inbox or while IMPACT is loading.
  // Do not fill another lane's lead into this new window.
  if (forceNewWindow) await openMatchingSalebaseScript(null, lane, true);
  return false;
}

async function impactTabForLane(tabs, lane) {
  const candidates = (tabs || []).filter((tab) => tab?.id).sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index));
  return queueSlotClaim(async () => {
    const map = await liveSlotMap();
    const owned = candidates.find((tab) => map[String(tab.id)] === lane);
    if (owned) return owned;
    // An assigned tab may be navigating outside /Lead/. Keep its ownership;
    // script recovery must never take a tab from the other phone.
    if (Object.values(map).includes(lane)) return null;
    const available = candidates.find((tab) => !map[String(tab.id)]);
    if (!available) return null;
    await writeWindowSlots(assignWindowSlot(map, available.id, lane));
    return available;
  });
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
  const slot = laneKey(request?.slot);
  const assigned = await scriptTabForLane(slot, tabs);
  if (assigned) {
    await selectSalebaseScript(assigned.id, request, slot);
    await syncScriptLeadForLane(slot);
    return;
  }
  // If the dashboard's Call link already opened a Salebase window (even at a
  // URL we do not recognise), use it instead of adding another tab.
  const opened = (await findSalebaseTabs(chrome)).filter((tab) => !before.has(tab.id));
  if (opened.length) {
    const tab = opened[0];
    await bindScriptTab(tab.id, slot);
    await selectSalebaseScript(tab.id, request, slot);
    return;
  }
  const created = await chrome.tabs.create({ url: SALEBASE_SCRIPTS_URL, active: false });
  if (created?.id) await bindScriptTab(created.id, slot);
}

// Reads the script dropdown, picks the option for this lead (see
// matchScriptOption) and selects it the way a click would. Every outcome is
// logged as salebase.scriptSelect and shown in the popup's Script line.
function scheduleScriptSelectionRetry(tabId, request, slot = '1', attempt = 1) {
  if (attempt > 4) return;
  const lane = laneKey(slot);
  const key = `${lane}:${tabId}`;
  clearTimeout(scriptSelectionRetries.get(key));
  scriptSelectionRetries.set(key, setTimeout(async () => {
    scriptSelectionRetries.delete(key);
    const current = pendingSalebaseChoices.get(lane);
    if (!current?.label || current.leadKey !== request.leadKey || await scriptSlotForTab(tabId) !== lane) return;
    await selectSalebaseScript(tabId, current, lane, attempt);
  }, 1200));
}

async function selectSalebaseScript(tabId, request, slot = '1', attempt = 0) {
  const isCurrent = () => pendingSalebaseChoices.get(laneKey(slot)) === request;
  if (!isCurrent()) return;
  let page = null;
  try {
    [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId }, func: readScriptDropdown });
  } catch (error) {
    // Still signing in or loading: the completed-load listener above retries.
    await reportScriptSelect(request, { status: 'tab-not-ready', reason: error.message });
    scheduleScriptSelectionRetry(tabId, request, slot, attempt + 1);
    return;
  }
  if (!isCurrent()) return;
  if (!page?.found) {
    await reportScriptSelect(request, { status: 'no-dropdown', reason: 'no #myDropdown with options on the Salebase page' });
    scheduleScriptSelectionRetry(tabId, request, slot, attempt + 1);
    return;
  }
  const options = page.options || [];
  const match = matchScriptOption(request.label, options, request.requestType, page.values || []);
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
  if (!isCurrent()) {
    const latest = pendingSalebaseChoices.get(laneKey(slot));
    if (latest?.label) scheduleScriptSelectionRetry(tabId, latest, slot, 0);
    return;
  }
  await reportScriptSelect(request, { ...base, status: applied?.ok ? 'selected' : 'select-failed', chosen: match.text, how: match.how, reason: applied?.reason || '' });
  if (applied?.ok || page.selectedIndex === match.index) await syncScriptLeadForLane(slot);
  else scheduleScriptSelectionRetry(tabId, request, slot, attempt + 1);
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
  const lane = laneKey(request?.slot);
  if (key === lastScriptSelectKeys.get(lane)) return;
  lastScriptSelectKeys.set(lane, key);
  const ok = ['selected', 'already-selected'].includes(entry.status);
  await appendLocalLog(ok || entry.status === 'no-script-window' ? 'info' : 'warn', 'salebase.scriptSelect', entry);
  await chrome.storage.session.set({ 'impact.scriptSelect': { ...entry, at: Date.now() } }).catch(() => {});
}

// ---- Two IMPACT windows, one per phone ----
// Slots are per lead tab, and claims run one at a time. Two windows opening
// together used to both read an empty list and both become Phone 1.
const WINDOW_SLOTS_KEY = 'impact.windowSlots';
let slotClaims = Promise.resolve();
async function readWindowSlots() {
  const stored = await chrome.storage.session.get(WINDOW_SLOTS_KEY).catch(() => ({}));
  return stored[WINDOW_SLOTS_KEY] || {};
}
async function writeWindowSlots(map) {
  await chrome.storage.session.set({ [WINDOW_SLOTS_KEY]: map }).catch(() => {});
}
function queueSlotClaim(task) {
  const run = slotClaims.then(task, task);
  slotClaims = run.then(() => {}, () => {});
  return run;
}
async function liveSlotMap() {
  const map = await readWindowSlots();
  try {
    const tabs = await chrome.tabs.query({});
    const open = new Set(tabs.map((item) => String(item.id)));
    return Object.fromEntries(Object.entries(map).filter(([id]) => open.has(id)));
  } catch (_error) {
    return map;
  }
}
function slotForTab(tab) {
  if (!tab?.id) return Promise.resolve('');
  return queueSlotClaim(async () => {
    const claimed = claimWindowSlot(await liveSlotMap(), tab.id);
    await writeWindowSlots(claimed.map);
    return claimed.slot;
  });
}
function setTabSlot(tab, slot) {
  if (!tab?.id) return Promise.resolve('1');
  const wanted = slot === '2' ? '2' : '1';
  return queueSlotClaim(async () => {
    await writeWindowSlots(assignWindowSlot(await liveSlotMap(), tab.id, wanted));
    return wanted;
  });
}
function forgetTab(tabId) {
  return queueSlotClaim(async () => {
    const map = await readWindowSlots();
    const slot = map[String(tabId)];
    if (!slot) return;
    delete map[String(tabId)];
    await writeWindowSlots(map);
    if (await cloudEnabled()) await clearCloudSlot(slot).catch(() => {});
  });
}
chrome.tabs.onRemoved.addListener((tabId) => { void forgetTab(tabId); });

// ---- Keeping the phone on IMPACT's lead ----
async function publishSkipReason(senderTab) {
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const reason = publisherDecision(senderTab, focused);
  if (reason && reason !== lastPublishSkip) await appendLocalLog('info', 'phoneSync.publishSkipped', { reason });
  lastPublishSkip = reason;
  return reason;
}

async function readPhoneLeadId(slot = '1') {
  if (await cloudEnabled()) return cloudLeadId(slot);
  const settings = await chrome.storage.local.get([STORAGE_KEYS.bridgeUrl, STORAGE_KEYS.bridgeToken]);
  const bridgeUrl = parseBridgeUrl(settings[STORAGE_KEYS.bridgeUrl]).replace(/\/$/, '');
  const response = await fetch(`${bridgeUrl}/api/current-lead?token=${encodeURIComponent(settings[STORAGE_KEYS.bridgeToken] || '')}&slot=${encodeURIComponent(slot)}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(8000), cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload.lead?.leadId || '';
}

function checkPhoneHasLead(leadId, slot = '1') {
  const key = slot === '2' ? '2' : '1';
  return verifyPhoneLead({
    expectedLeadId: leadId,
    currentLeadId: () => slotMemory.get(key)?.leadId || '',
    readPhoneLeadId: () => readPhoneLeadId(key),
    republish: () => {
      const remembered = slotMemory.get(key)?.lead;
      return remembered?.leadId === leadId ? publishLead(remembered, { force: true, slot: key, eventName: 'phoneSync.resync' }) : Promise.resolve();
    },
    log: appendLocalLog
  }).catch(() => {});
}

async function followAfterCommand(tabId, fromLeadId, slot = '1') {
  const generation = (followGenerations.get(tabId) || 0) + 1;
  followGenerations.set(tabId, generation);
  await followLeadChange({
    fromLeadId,
    isCurrent: () => followGenerations.get(tabId) === generation,
    readLead: async () => {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'impact/readCurrentLead' });
      if (!response?.lead?.available) return null;
      const { scriptDetails, ...lead } = response.lead;
      noteScriptGroup(lead, scriptDetails);
      await rememberScriptLead(lead, scriptDetails, tabId, slot).catch(() => {});
      return lead;
    },
    publish: (lead) => publishLead(lead, { force: true, slot, eventName: 'phoneSync.followPublished' }).catch(() => {}),
    verify: async () => {}, // writeLead already checks the phone when the lead changes
    log: appendLocalLog
  }).catch(() => {});
}

// ---- Lead details for the Salebase phone script ----
// Script details come directly from the lane's IMPACT tab, independently of cloud publishing.
const scriptLaneRefreshes = new Map();
function refreshScriptLane(slot) {
  const lane = laneKey(slot);
  if (scriptLaneRefreshes.has(lane)) return scriptLaneRefreshes.get(lane);
  const run = (async () => {
    const tabs = await chrome.tabs.query({url:'https://mobile.impact.ailife.com/Lead/*'});
    const tab = await impactTabForLane(tabs, lane);
    if (!tab?.id) return;
    const response = await Promise.race([chrome.tabs.sendMessage(tab.id,{type:'impact/readCurrentLead'}).catch(()=>null),new Promise(resolve=>setTimeout(()=>resolve(null),3000))]);
    if (!response?.lead?.available) return;
    const {scriptDetails,...lead}=response.lead;
    noteScriptGroup(lead,scriptDetails);
    await rememberScriptLead(lead,scriptDetails,tab.id,lane);
    await openMatchingSalebaseScript(lead,lane);
    await syncScriptLeadForLane(lane);
  })().finally(()=>scriptLaneRefreshes.delete(lane));
  scriptLaneRefreshes.set(lane,run);
  return run;
}

async function readScriptLead(scriptTabId) {
  const stored = await chrome.storage.session.get(SCRIPT_LEADS_KEY).catch(() => ({}));
  const records = stored[SCRIPT_LEADS_KEY] || {};
  return records[String(scriptTabId)] || null;
}

async function rememberScriptLead(lead, details, sourceTabId, slot = '1') {
  if (!lead?.available || !lead.leadName) return;
  let user = null;
  try { user = (await client.auth.getSession()).data?.session?.user || null; } catch (_error) {}
  const fields = scriptFieldsFromLead(lead, details || {}, user);
  if (!fields) return;
  const lane = laneKey(slot);
  const previous = laneScriptFields.get(lane);
  if (previous && previous.sourceTabId === sourceTabId && JSON.stringify(previous.fields) === JSON.stringify(fields)) return;
  laneScriptFields.set(lane, { fields, sourceTabId, at: Date.now() });
  await syncScriptLeadForLane(lane);
}

let scriptLeadWrites = Promise.resolve();
function syncScriptLeadForLane(slot) {
  const run = scriptLeadWrites.then(() => writeScriptLeadForLane(slot));
  scriptLeadWrites = run.catch(() => {});
  return run;
}

async function writeScriptLeadForLane(slot) {
  const lane = laneKey(slot);
  const fields = laneScriptFields.get(lane);
  const map = await scriptSlotMap();
  const tabIds = Object.entries(map).filter(([, assigned]) => assigned === lane).map(([id]) => id);
  if (!tabIds.length || !fields) return;
  const stored = await chrome.storage.session.get(SCRIPT_LEADS_KEY).catch(() => ({}));
  const records = stored[SCRIPT_LEADS_KEY] || {};
  const record = { ...fields, slot: lane, scriptType: pendingSalebaseChoices.get(lane)?.label || '' };
  if (tabIds.every((tabId) => JSON.stringify(records[tabId]) === JSON.stringify(record))) return;
  const next = { ...records };
  for (const tabId of tabIds) next[tabId] = record;
  await chrome.storage.session.set({ [SCRIPT_LEADS_KEY]: next });
}

async function clearImpactScriptLeadForTab(tabId) {
  if (![...laneScriptFields.values()].some((record) => record?.sourceTabId === tabId)) return;
  for (const [slot, record] of laneScriptFields) {
    if (record?.sourceTabId === tabId) laneScriptFields.delete(slot);
  }
}

async function clearScriptLeadForTab(tabId) {
  await clearImpactScriptLeadForTab(tabId);
  const map = await scriptSlotMap();
  if (map[String(tabId)]) {
    delete map[String(tabId)];
    await writeScriptSlotMap(map);
  }
}

async function clearScriptLead() {
  laneScriptFields.clear();
  await chrome.storage.session.remove([SCRIPT_LEADS_KEY, SCRIPT_TAB_SLOTS_KEY]).catch(() => {});
}

async function injectScriptFill() {
  const tabs = await findSalebaseScriptTabs(chrome).catch(() => []);
  await Promise.all(tabs.map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [SCRIPT_FILL_CONTENT_SCRIPT, CALM_SCRIPT_CONTENT_SCRIPT] }).catch(() => {})));
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

async function refreshAppointmentReminders() {
  if (!callingHoursOpen()) {
    await chrome.storage.session.set({ 'impact.appointmentReminders': [] }).catch(() => {});
    return;
  }
  const from = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 16 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client.from('scheduled_events').select('impact_lead_id,lead_name,starts_at,all_day,kind').gte('starts_at', from).lte('starts_at', to).limit(100);
  const reminders = error ? [] : dueReminders(data || []);
  await chrome.storage.session.set({ 'impact.appointmentReminders': reminders.slice(0, 8) }).catch(() => {});
}

if (!callingHoursOpen()) void client.auth.signOut({ scope: 'local' });
void refreshAppointmentReminders();
setInterval(() => {
  if (!callingHoursOpen()) void client.auth.signOut({ scope: 'local' });
  else void refreshAppointmentReminders();
}, 60000);
