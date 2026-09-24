import { STORAGE_KEYS } from "../shared/storage-keys.js";
import { accessToken } from "../shared/auth-runtime.js";

try { await accessToken(); } catch { location.replace('../account/account.html'); throw new Error('Sign-in required'); }
chrome.storage.onChanged.addListener((changes) => {
  if (changes['impact.supabase.session'] && !changes['impact.supabase.session'].newValue) location.replace('../account/account.html');
});

const tabStatus = document.querySelector("#tabStatus");
const snapshotOutput = document.querySelector("#snapshotOutput");
const leadPreview = document.querySelector("#leadPreview");
const phoneStatus = document.querySelector("#phoneStatus");
const logOutput = document.querySelector("#logOutput");
const updatePhoneButton = document.querySelector("#updatePhone");
const runDiagnosticButton = document.querySelector("#runDiagnostic");
const pickElementButton = document.querySelector("#pickElement");
const openOptionsButton = document.querySelector("#openOptions");
const clearLogsButton = document.querySelector("#clearLogs");

let activeTab = null;
let currentLeadPreview = null;

init();

async function init() {
  activeTab = await getActiveTab();
  tabStatus.textContent = activeTab?.url || "No active tab detected.";
  await loadLastSnapshot();
  await loadLogs();
}

runDiagnosticButton.addEventListener("click", async () => {
  await withBusy(runDiagnosticButton, async () => {
    const response = await sendContentMessage({ type: "impact/getSnapshot" });
    if (!response.ok) {
      throw new Error(response.error || "Diagnostic failed.");
    }
    snapshotOutput.textContent = JSON.stringify(response.snapshot, null, 2);
    renderLeadPreview(response.snapshot.localLeadPreview);
    currentLeadPreview = response.snapshot.localLeadPreview;
    await loadLogs();
  });
});

updatePhoneButton.addEventListener("click", async () => {
  await withBusy(updatePhoneButton, async () => {
    phoneStatus.textContent = "Reading the current IMPACT lead...";
    const lead = await getFreshLeadPreview();
    phoneStatus.textContent = "Sending to the phone bridge...";
    await publishLeadToPhone(lead);
  });
});

pickElementButton.addEventListener("click", async () => {
  await withBusy(pickElementButton, async () => {
    const response = await sendContentMessage({ type: "impact/startPicker" });
    if (!response.ok) {
      throw new Error(response.error || "Could not start picker.");
    }
    window.close();
  });
});

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

clearLogsButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "impact/clearLogs" });
  await loadLogs();
});

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function ensureInjected() {
  if (!activeTab?.id) {
    throw new Error("No active tab.");
  }

  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    files: ["src/content/selector-config.js", "src/content/impact-diagnostic.js"]
  });
}

async function sendContentMessage(message) {
  await withTimeout(ensureInjected(), 5000, "Could not connect to IMPACT. Refresh the IMPACT page and try again.");
  return withTimeout(chrome.tabs.sendMessage(activeTab.id, message), 10000, "IMPACT did not respond. Refresh the IMPACT page and try again.");
}

async function loadLastSnapshot() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.lastSnapshot);
  const snapshot = result[STORAGE_KEYS.lastSnapshot];
  if (snapshot) {
    snapshotOutput.textContent = JSON.stringify(snapshot, null, 2);
    renderLeadPreview(snapshot.localLeadPreview);
    currentLeadPreview = snapshot.localLeadPreview;
  }
}

async function getFreshLeadPreview() {
  const response = await sendContentMessage({ type: "impact/getSnapshot", includeNextLead: false });
  if (!response.ok) {
    throw new Error(response.error || "Diagnostic failed.");
  }
  snapshotOutput.textContent = JSON.stringify(response.snapshot, null, 2);
  renderLeadPreview(response.snapshot.localLeadPreview);
  currentLeadPreview = response.snapshot.localLeadPreview;
  return currentLeadPreview;
}

async function publishLeadToPhone(lead) {
  const response = await withTimeout(chrome.runtime.sendMessage({
    type: "impact/publishLead",
    lead
  }), 12000, "The phone bridge did not respond. Check that it is running and the extension Bridge URL is http://127.0.0.1:8787.");

  if (!response.ok) {
    throw new Error(response.error || "Could not send lead to phone.");
  }

  phoneStatus.textContent = `Sent to bridge at ${new Date().toLocaleTimeString()}. Open the local phone link to view it.`;
  await loadLogs();
}

function renderLeadPreview(preview) {
  leadPreview.replaceChildren();

  if (!preview?.available) {
    currentLeadPreview = null;
    leadPreview.textContent = "No lead detail panel detected.";
    return;
  }

  const name = document.createElement("div");
  name.className = "leadName";
  name.textContent = preview.leadName || "Current lead";
  leadPreview.append(name);

  const details = [
    preview.requestType ? `Request type: ${preview.requestType}` : "",
    preview.language ? `Language: ${preview.language}` : "",
    preview.email ? `Email: ${preview.email}` : "",
    preview.address ? `Address: ${preview.address}` : ""
  ].filter(Boolean);

  for (const detail of details) {
    const item = document.createElement("div");
    item.className = "leadDetail";
    item.textContent = detail;
    leadPreview.append(item);
  }

  if (!preview.phones?.length) {
    const empty = document.createElement("p");
    empty.textContent = "No phone numbers detected.";
    leadPreview.append(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "phoneList";

  for (const phone of preview.phones) {
    const row = document.createElement("div");
    row.className = "phoneRow";

    const label = document.createElement("span");
    label.textContent = `${phone.label}: ${phone.number}`;

    const link = document.createElement("a");
    link.href = phone.dialHref;
    link.textContent = "Call";
    link.className = "callButton";

    row.append(label, link);
    list.append(row);
  }

  leadPreview.append(list);
}

async function loadLogs() {
  const response = await withTimeout(chrome.runtime.sendMessage({ type: "impact/getLogs" }), 3000, "Could not load diagnostic logs.");
  const logs = response.logs || [];
  logOutput.textContent = logs.length ? JSON.stringify(logs.slice(-20), null, 2) : "No logs yet.";
}

async function withBusy(button, callback) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Working...";
  try {
    await callback();
  } catch (error) {
    snapshotOutput.textContent = `Error: ${error.message}`;
    phoneStatus.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}
