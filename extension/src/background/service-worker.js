import { LOG_LIMIT, STORAGE_KEYS } from "../shared/storage-keys.js";
import { parseBridgeUrl } from "../shared/bridge-config.js";
import { accessToken } from "../shared/auth-runtime.js";
import { cloudEnabled } from '../shared/cloud-sync.js';
import { publishCloud, takeCloudCommand, reportCloudResult } from './cloud-desktop.js';

let lastAutoPublishFingerprint = "";
let lastAutoPublishAt = 0;
let lastPublishedLead = null;
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

async function getPhoneCommand(senderTab) {
  // Only the active lead tab may consume commands. Inbox/background tabs must
  // never take a command and silently discard it because they cannot navigate.
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!senderTab?.id || senderTab.id !== activeTab?.id ||
      !/^https:\/\/mobile\.impact\.ailife\.com\/Lead\/(InboxDetail|WhatHappend|SetAppointment)(?:[?#]|$)/.test(activeTab.url || "")) {
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
