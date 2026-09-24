import { STORAGE_KEYS } from "../shared/storage-keys.js";

const tabStatus = document.querySelector("#tabStatus");
const snapshotOutput = document.querySelector("#snapshotOutput");
const leadPreview = document.querySelector("#leadPreview");
const phoneStatus = document.querySelector("#phoneStatus");
const logOutput = document.querySelector("#logOutput");
const runDiagnosticButton = document.querySelector("#runDiagnostic");
const sendToPhoneButton = document.querySelector("#sendToPhone");
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

sendToPhoneButton.addEventListener("click", async () => {
  await withBusy(sendToPhoneButton, async () => {
    const lead = currentLeadPreview || (await getFreshLeadPreview());
    const response = await chrome.runtime.sendMessage({
      type: "impact/publishLead",
      lead
    });

    if (!response.ok) {
      throw new Error(response.error || "Could not send lead to phone.");
    }

    phoneStatus.textContent = "Sent current lead to phone bridge.";
    await loadLogs();
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
  await ensureInjected();
  return chrome.tabs.sendMessage(activeTab.id, message);
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
  const response = await sendContentMessage({ type: "impact/getSnapshot" });
  if (!response.ok) {
    throw new Error(response.error || "Diagnostic failed.");
  }
  snapshotOutput.textContent = JSON.stringify(response.snapshot, null, 2);
  renderLeadPreview(response.snapshot.localLeadPreview);
  currentLeadPreview = response.snapshot.localLeadPreview;
  return currentLeadPreview;
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
  const response = await chrome.runtime.sendMessage({ type: "impact/getLogs" });
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
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
