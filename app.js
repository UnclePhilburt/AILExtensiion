import { client, accessToken } from './auth-runtime.js';
import { cloudEnabled, cloudState, cloudTouchPhone, cloudSend, watchCloud, visibleLead, isOnline } from './cloud-sync.js';
const statusEl = document.querySelector("#status");
const leadCard = document.querySelector("#leadCard");
const bridgeUrlInput = document.querySelector("#bridgeUrl");
const bridgeTokenInput = document.querySelector("#bridgeToken");
const saveBridgeButton = document.querySelector("#saveBridge");
const previousLeadButton = document.querySelector("#previousLead");
const nextLeadButton = document.querySelector("#nextLead");
const noAnswerButton = document.querySelector("#noAnswer");
const virtualAppointmentButton = document.querySelector("#virtualAppointment");
const refusedAppointmentButton = document.querySelector("#refusedAppointment");
const callResults = document.querySelector("#callResults");
const params = new URLSearchParams(location.search);

let bridgeLead = null;
let displayedLead = null;
let previousLeads = [];
let displayedLeadKey = "";
let leadEvents = null;
let eventsConnected = false;
let calledLeadKey = "";
let signedIn = false;
let historyLeadKey = "";
const useCloud = await cloudEnabled();
let currentCloudState = null, stopCloudWatch = null, cloudReadBusy = false, lastCloudResult = '', lastPhoneTouch = 0;
let cloudGeneration = 0;

const savedBridgeUrl = localStorage.getItem("impact.bridgeUrl") || "";
const savedBridgeToken = localStorage.getItem("impact.bridgeToken") || "";
const localToken = document.querySelector('meta[name="impact-bridge-token"]')?.content;
bridgeUrlInput.value = localToken ? location.origin : params.get("bridge") || savedBridgeUrl || location.origin;
bridgeTokenInput.value = localToken ? decodeURIComponent(localToken) : params.get("token") || savedBridgeToken || "";
if (localToken) {
  document.querySelector("#bridgeSetup").hidden = true;
  // Remove obsolete pairing parameters from bookmarks copied from this page.
  history.replaceState(null, "", location.pathname + (useCloud ? '' : '?mode=local'));
}
if (useCloud) document.querySelector('#bridgeSetup').hidden = true;
document.querySelector('#connectionModeLabel').textContent = useCloud ? 'Cloud connection' : 'Local connection';
if (!useCloud) document.querySelector('.accountLink').href = 'account.html?mode=local';

persistBridgeSettings();

saveBridgeButton.addEventListener("click", () => {
  localStorage.setItem("impact.bridgeUrl", bridgeUrlInput.value.trim());
  localStorage.setItem("impact.bridgeToken", bridgeTokenInput.value.trim());
  connectLiveUpdates();
});

bridgeUrlInput.addEventListener("input", persistBridgeSettings);
bridgeTokenInput.addEventListener("input", persistBridgeSettings);
previousLeadButton.addEventListener("click", showPreviousLead);
nextLeadButton.addEventListener("click", showNextLead);
noAnswerButton.addEventListener("click", () => sendComputerCommand("no-answer", { leadId: displayedLead?.leadId }));
virtualAppointmentButton.addEventListener("click", () => sendComputerCommand("virtual-appointment", { leadId: displayedLead?.leadId }));
refusedAppointmentButton.addEventListener("click", () => sendComputerCommand("refused-appointment", { leadId: displayedLead?.leadId }));

client.auth.onAuthStateChange((_event, session) => {
  signedIn = Boolean(session);
  if (!signedIn) {
    cloudGeneration++; stopCloudWatch?.(); stopCloudWatch = null; currentCloudState = null;
    leadEvents?.abort();
    leadEvents = null;
    eventsConnected = false;
    receiveBridgeLead(null, null);
    location.replace(useCloud ? 'account.html?next=workspace.html' : 'account.html?next=workspace.html&mode=local');
  } else {
    document.querySelector('main').hidden = false;
    void connectLiveUpdates();
  }
});
// Poll only as a fallback while the live connection is unavailable.
setInterval(() => { if (signedIn && (useCloud || !eventsConnected)) refreshLead(); }, useCloud ? 5000 : 2500);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) connectLiveUpdates();
});

async function connectLiveUpdates() {
  if (!signedIn) return;
  if (useCloud) {
    const generation = ++cloudGeneration;
    stopCloudWatch?.(); stopCloudWatch = null;
    try {
      const stop = await watchCloud(() => { void refreshCloud(); });
      if (!signedIn || generation !== cloudGeneration) { stop(); return; }
      stopCloudWatch = stop;
      await refreshCloud();
    } catch (error) { statusEl.textContent = error.message; }
    return;
  }
  leadEvents?.abort();
  eventsConnected = false;
  const bridgeUrl = bridgeUrlInput.value.trim().replace(/\/$/, "");
  const token = bridgeTokenInput.value.trim();
  if (!bridgeUrl || !token) {
    refreshLead();
    return;
  }
  const stream = new AbortController();
  leadEvents = stream;
  try {
    const bearer = await accessToken();
    const response = await fetch(`${bridgeUrl}/api/events?token=${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${bearer}` }, signal: stream.signal, cache: 'no-store'
    });
    if (!response.ok) throw new Error('Sign in on both devices with the same account.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (signedIn && stream === leadEvents) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').find(line => line.startsWith('data: '));
        if (!data || !signedIn || stream !== leadEvents) continue;
        if (frame.includes('event: auth-required')) throw new Error('Your account session expired. Sign in again.');
        const payload = JSON.parse(data.slice(6));
        if (frame.includes('event: command-result')) statusEl.textContent = payload.message;
        else { eventsConnected = true; receiveBridgeLead(payload.lead, payload.updatedAt); }
      }
    }
  } catch (error) {
    if (stream === leadEvents && !stream.signal.aborted) {
      receiveBridgeLead(null, null);
      statusEl.textContent = error.message;
    }
  } finally {
    if (stream !== leadEvents) return;
    eventsConnected = false;
    if (signedIn) setTimeout(connectLiveUpdates, 1500);
  }
}

async function refreshLead() {
  if (!signedIn) return;
  if (useCloud) return refreshCloud();
  try {
    const bridgeUrl = bridgeUrlInput.value.trim().replace(/\/$/, "");
    const token = bridgeTokenInput.value.trim();
    if (!bridgeUrl || !token) {
      statusEl.textContent = "Bridge URL and token required once. Then updates are automatic.";
      return;
    }

    const response = await fetch(`${bridgeUrl}/api/current-lead?token=${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    if (signedIn && !eventsConnected) receiveBridgeLead(payload.lead, payload.updatedAt);
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function refreshCloud() {
  if (!signedIn || cloudReadBusy) return;
  cloudReadBusy = true;
  const generation = cloudGeneration;
  try {
    const state = await cloudState();
    if (!signedIn || generation !== cloudGeneration) return;
    currentCloudState = state;
    receiveBridgeLead(visibleLead(state), state?.lead_updated_at);
    if (!isOnline(state?.desktop_seen)) statusEl.textContent = 'Open IMPACT on your computer to connect.';
    if (state?.result?.at && state.result.at !== lastCloudResult) {
      lastCloudResult = state.result.at;
      if (Date.now() - Date.parse(state.result.at) < 15000) statusEl.textContent = state.result.message;
    }
    if (Date.now() - lastPhoneTouch > 10000) { lastPhoneTouch = Date.now(); await cloudTouchPhone(); }
  } catch (error) {
    currentCloudState = null; receiveBridgeLead(null, null); statusEl.textContent = error.message;
  } finally { cloudReadBusy = false; }
}

function persistBridgeSettings() {
  localStorage.setItem("impact.bridgeUrl", bridgeUrlInput.value.trim());
  localStorage.setItem("impact.bridgeToken", bridgeTokenInput.value.trim());
}

function receiveBridgeLead(lead, updatedAt) {
  bridgeLead = lead;
  if (!lead?.available) {
    calledLeadKey = "";
    displayedLead = null;
    displayedLeadKey = "";
    previousLeads = [];
    renderLead(null, updatedAt, "bridge");
    return;
  }

  const nextKey = getLeadKey(lead);
  if (!displayedLead || nextKey !== displayedLeadKey) {
    calledLeadKey = "";
    displayedLead = lead;
    displayedLeadKey = nextKey;
    previousLeads = [];
  }

  // Preload and contact updates can arrive without changing the lead's identity.
  displayedLead = lead;

  renderLead(displayedLead, updatedAt, displayedLead === bridgeLead ? "bridge" : "local");
}

async function showNextLead() {
  await sendComputerCommand("next");
}

async function showPreviousLead() {
  await sendComputerCommand("previous");
}

async function sendComputerCommand(type, details = {}) {
  if (!signedIn) return;
  try {
    if (useCloud) {
      await cloudSend(currentCloudState, {type, leadId: displayedLead?.leadId, ...details});
      statusEl.textContent = type === 'call' ? 'Call sent to IMPACT.' : 'Action sent to your computer…';
      return;
    }
    const bridgeUrl = bridgeUrlInput.value.trim().replace(/\/$/, "");
    const token = bridgeTokenInput.value.trim();
    if (!bridgeUrl || !token) {
      statusEl.textContent = "Bridge URL and token required.";
      return;
    }

    const response = await fetch(`${bridgeUrl}/api/command?token=${encodeURIComponent(token)}`, {
      method: "POST",
      keepalive: true,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ type, ...details })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    statusEl.textContent = type === "virtual-appointment" ? "Opening Virtual Appointment in IMPACT..." : type === "refused-appointment" ? "Opening Refused Appointment in IMPACT..." : type === "no-answer" ? "Sending No Answer to IMPACT..." : type === "call" ? `Call ${details.phoneType} sent to IMPACT.` : type === "next"
      ? "Advancing IMPACT on computer..."
      : "Moving IMPACT back on computer...";
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

function renderLead(lead, updatedAt, source) {
  renderCallHistory(lead);
  if (!lead?.available) {
    leadCard.className = "leadCard empty";
    leadCard.textContent = "Send a lead from the Brave extension.";
    updateNavButtons();
    statusEl.textContent = "No current lead.";
    return;
  }

  statusEl.textContent = updatedAt
    ? `Updated ${new Date(updatedAt).toLocaleTimeString()}`
    : source === "local"
      ? "Loaded from phone preload."
      : "Lead loaded.";
  leadCard.className = "leadCard";
  leadCard.replaceChildren();

  if (lead.requestType) {
    const badge = document.createElement("div");
    badge.className = "requestBadge";
    badge.textContent = lead.requestType;
    leadCard.append(badge);
  }
  const name = document.createElement("h2");
  name.textContent = lead.leadName || "Current lead";
  leadCard.append(name);

  appendDetail("Language", lead.language);
  appendDetail("Email", lead.email);
  appendDetail("Address", lead.address);

  const phoneList = document.createElement("div");
  phoneList.className = "phoneList";
  for (const phone of lead.phones || []) {
    const link = document.createElement("a");
    link.className = "callLink";
    link.href = phone.dialHref;
    const icon = document.createElement("span");
    icon.className = "callIcon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "☎";
    const content = document.createElement("span");
    content.className = "callText";
    const label = document.createElement("span");
    label.className = "callLabel";
    label.textContent = `Call ${phone.label}`;
    const number = document.createElement("strong");
    number.textContent = phone.number;
    content.append(label, number);
    link.append(icon, content);
    link.addEventListener("click", () => {
      calledLeadKey = getLeadKey(lead);
      document.querySelector("#callHistory").open = false;
      updateNavButtons();
      // Keep native tel: navigation in the user's tap, while the small command
      // continues sending if the phone browser moves into the dialer.
      if (lead.leadId && ["Home", "Mobile"].includes(phone.label)) {
        void sendComputerCommand("call", { leadId: lead.leadId, phoneType: phone.label, phoneNumber: phone.number });
      } else {
        statusEl.textContent = "Dialing only: refresh the IMPACT lead to enable call registration.";
      }
    });
    phoneList.append(link);
  }
  leadCard.append(phoneList);
  updateNavButtons();
}

function updateNavButtons() {
  const callStarted = Boolean(displayedLead?.available && calledLeadKey === getLeadKey(displayedLead));
  callResults.hidden = !callStarted;
  noAnswerButton.disabled = !callStarted || !displayedLead?.leadId;
  virtualAppointmentButton.disabled = !callStarted || !displayedLead?.leadId;
  refusedAppointmentButton.disabled = !callStarted || !displayedLead?.leadId;
  previousLeadButton.disabled = !displayedLead?.available;
  nextLeadButton.disabled = !displayedLead?.available;
}

function renderCallHistory(lead) {
  const card = document.querySelector("#callHistory");
  const entries = document.querySelector("#historyEntries");
  const key = lead?.available ? getLeadKey(lead) : "";
  if (key !== historyLeadKey) card.open = true;
  historyLeadKey = key;
  card.hidden = !lead?.available;
  entries.replaceChildren();
  const history = Array.isArray(lead?.callHistory) ? lead.callHistory : [];
  document.querySelector("#historyCount").textContent = history.length ? `(${history.length})` : "";
  for (const entry of history.length ? history : ["No previous activity found on this lead."]) {
    const item = document.createElement("li");
    item.textContent = entry;
    entries.append(item);
  }
}

function getLeadKey(lead) {
  if (lead?.leadId) return `lead:${lead.leadId}`;
  return [
    lead?.leadName || "",
    lead?.email || "",
    lead?.address || "",
    (lead?.phones || []).map((phone) => phone.number).join("|")
  ].join("::");
}

function appendDetail(label, value) {
  if (!value) {
    return;
  }

  const row = document.createElement("div");
  row.className = "detail";
  const caption = document.createElement("span");
  caption.className = "detailLabel";
  caption.textContent = label;
  const content = document.createElement("span");
  content.className = "detailValue";
  content.textContent = value;
  row.append(caption, content);
  leadCard.append(row);
}

function appendDetailTo(parent, label, value) {
  if (!value) {
    return;
  }

  const row = document.createElement("div");
  row.className = "detail";
  row.textContent = `${label}: ${value}`;
  parent.append(row);
}
