import { LOG_LIMIT, STORAGE_KEYS } from "../shared/storage-keys.js";

let lastAutoPublishFingerprint = "";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    autoPublishLead(message.lead)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "impact/getPhoneCommand") {
    getPhoneCommand()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function getPhoneCommand() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.bridgeUrl,
    STORAGE_KEYS.bridgeToken
  ]);
  const bridgeUrl = result[STORAGE_KEYS.bridgeUrl] || "http://127.0.0.1:8787";
  const bridgeToken = result[STORAGE_KEYS.bridgeToken] || "";

  if (!bridgeToken) {
    return { command: null };
  }

  const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/api/command/next?token=${encodeURIComponent(bridgeToken)}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Bridge command poll failed: HTTP ${response.status}`);
  }

  return response.json();
}

async function autoPublishLead(lead) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.autoPublish);
  const autoPublish = result[STORAGE_KEYS.autoPublish] !== false;

  if (!autoPublish) {
    return { skipped: true, reason: "autoPublish disabled" };
  }

  const fingerprint = makeLeadFingerprint(lead);
  if (fingerprint === lastAutoPublishFingerprint) {
    return { skipped: true, reason: "duplicate lead payload" };
  }

  try {
    const result = await publishLead(lead, { eventName: "bridge.leadAutoPublished" });
    lastAutoPublishFingerprint = fingerprint;
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

  const result = await chrome.storage.local.get([
    STORAGE_KEYS.bridgeUrl,
    STORAGE_KEYS.bridgeToken
  ]);
  const bridgeUrl = result[STORAGE_KEYS.bridgeUrl] || "http://127.0.0.1:8787";
  const bridgeToken = result[STORAGE_KEYS.bridgeToken] || "";

  if (!bridgeToken) {
    throw new Error("Bridge token is missing. Start the phone bridge and paste its token in Options.");
  }

  const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/api/current-lead`, {
    method: "POST",
    headers: {
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
    language: lead?.language || "",
    email: lead?.email || "",
    address: lead?.address || "",
    phones: lead?.phones || [],
    nextLeadAvailable: Boolean(lead?.nextLead?.available),
    nextLeadName: lead?.nextLead?.leadName || "",
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
