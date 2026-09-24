import { client, accessToken } from './auth-runtime.js';
import { cloudEnabled, cloudState, cloudTouchPhone, cloudSend, watchCloud, visibleLead, isOnline } from './cloud-sync.js';
import { createPendingCall, readPendingCall, writePendingCall, pendingCallDecision, markPendingCallResult, isCallResultCommand } from './pending-call.js';
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
const appointmentPicker = document.querySelector("#appointmentPicker");
const appointmentDays = document.querySelector("#appointmentDays");
const appointmentTimes = document.querySelector("#appointmentTimes");
const appointmentHint = document.querySelector("#appointmentHint");
const pendingCallNotice = document.querySelector("#pendingCallNotice");
const pendingCallText = document.querySelector("#pendingCallText");
const dismissPendingCallButton = document.querySelector("#dismissPendingCall");
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
let selectedAppointmentDay = "";
// Previous/Next stay locked until the phone sees the lead IMPACT moved to, so a
// tap can never be sent with the old lead while the phone is still catching up.
let navPending = null;
// The call the rep started from this phone, kept in localStorage per user so a
// page reload (common when the phone switches to the dialer) keeps the
// "How did it go?" controls for the lead that was called.
let currentUserId = "";
let pendingCall = null;

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
noAnswerButton.addEventListener("click", () => sendCallResult("no-answer"));
virtualAppointmentButton.addEventListener("click", () => sendCallResult("virtual-appointment"));
refusedAppointmentButton.addEventListener("click", () => sendCallResult("refused-appointment"));
dismissPendingCallButton.addEventListener("click", dismissPendingCall);

client.auth.onAuthStateChange((_event, session) => {
  signedIn = Boolean(session);
  const userId = signedIn ? String(session.user?.id || "") : "";
  if (userId !== currentUserId) {
    currentUserId = userId;
    pendingCall = userId ? readPendingCall(localStorage, userId, Date.now()) : null;
  }
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
        if (frame.includes('event: command-result')) { statusEl.textContent = payload.message; clearNavigationPending(); }
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
      if (Date.now() - Date.parse(state.result.at) < 15000) { statusEl.textContent = state.result.message; clearNavigationPending(); }
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
    // Keep the saved call: the lead is often only briefly unavailable (computer
    // reconnecting, page reload still loading) and comes back unchanged.
    calledLeadKey = "";
    renderPendingCallReminder(null);
    displayedLead = null;
    displayedLeadKey = "";
    previousLeads = [];
    navPending = null;
    renderLead(null, updatedAt, "bridge");
    return;
  }

  const nextKey = getLeadKey(lead);
  if (!displayedLead || nextKey !== displayedLeadKey) {
    displayedLead = lead;
    displayedLeadKey = nextKey;
    previousLeads = [];
    selectedAppointmentDay = "";
    navPending = null;
  }

  // Preload and contact updates can arrive without changing the lead's identity.
  displayedLead = lead;
  applyPendingCall(nextKey);

  renderLead(displayedLead, updatedAt, displayedLead === bridgeLead ? "bridge" : "local");
}

function setPendingCall(record) {
  pendingCall = record;
  if (currentUserId) writePendingCall(localStorage, currentUserId, record);
}

function applyPendingCall(leadKey) {
  const decision = pendingCallDecision(pendingCall, leadKey, Date.now());
  if (decision.clear) setPendingCall(null);
  calledLeadKey = decision.calledLeadKey;
  renderPendingCallReminder(decision.reminder);
}

function renderPendingCallReminder(record) {
  pendingCallNotice.hidden = !record;
  if (!record) return;
  const time = new Date(record.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const name = record.leadName || "your last lead";
  pendingCallText.textContent = `No result was sent for your ${time} call to ${name}. IMPACT is on a different lead now. To log it from the phone, go back to ${name} in IMPACT. Otherwise log it on your computer and dismiss this.`;
}

function dismissPendingCall() {
  setPendingCall(null);
  calledLeadKey = "";
  renderPendingCallReminder(null);
  updateNavButtons();
  renderAppointmentPicker(displayedLead);
}

// Results always go to the lead that was called, never just whatever lead is on screen.
async function sendCallResult(type, details = {}) {
  const call = pendingCall;
  if (!call?.leadId || !displayedLead?.available || call.leadKey !== getLeadKey(displayedLead)) {
    statusEl.textContent = "Tap Call on this lead first, then choose the result.";
    return false;
  }
  const sent = await sendComputerCommand(type, { ...details, leadId: call.leadId });
  if (sent && isCallResultCommand(type) && pendingCall === call) setPendingCall(markPendingCallResult(call, Date.now()));
  return sent;
}

async function showNextLead() {
  await sendNavigation("next");
}

async function showPreviousLead() {
  await sendNavigation("previous");
}

function navigationPending() {
  if (navPending && Date.now() > navPending.until) navPending = null;
  return Boolean(navPending);
}

function clearNavigationPending() {
  if (!navPending) return;
  navPending = null;
  updateNavButtons();
}

async function sendNavigation(type) {
  if (!displayedLead?.available || navigationPending()) return;
  const pending = { until: Date.now() + 10000 };
  navPending = pending;
  updateNavButtons();
  const sent = await sendComputerCommand(type);
  if (navPending !== pending) return;
  if (!sent) {
    navPending = null;
    updateNavButtons();
    if (useCloud) void refreshCloud();
    return;
  }
  // Pick up the new lead promptly even if the live update is slow.
  for (const delay of [700, 1800, 4000]) setTimeout(() => { if (navPending === pending) void refreshLead(); }, delay);
  setTimeout(() => { if (navPending === pending) clearNavigationPending(); }, 10100);
}

async function sendComputerCommand(type, details = {}) {
  if (!signedIn) return false;
  try {
    if (useCloud) {
      await cloudSend(currentCloudState, {type, leadId: displayedLead?.leadId, ...details});
      statusEl.textContent = type === 'call' ? 'Call sent to IMPACT.' : type === 'virtual-appointment' ? 'Opening Virtual Appointment in IMPACT…' : type === 'virtual-appointment-day' ? 'Selecting that day in IMPACT…' : type === 'virtual-appointment-slot' ? 'Setting that appointment in IMPACT…' : type === 'previous' ? 'Moving IMPACT back on computer…' : type === 'next' ? 'Advancing IMPACT on computer…' : 'Action sent to your computer…';
      return true;
    }
    const bridgeUrl = bridgeUrlInput.value.trim().replace(/\/$/, "");
    const token = bridgeTokenInput.value.trim();
    if (!bridgeUrl || !token) {
      statusEl.textContent = "Bridge URL and token required.";
      return false;
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

    statusEl.textContent = type === "virtual-appointment" ? "Opening Virtual Appointment in IMPACT..." : type === "virtual-appointment-day" ? "Selecting that day in IMPACT..." : type === "virtual-appointment-slot" ? "Setting that appointment in IMPACT..." : type === "refused-appointment" ? "Opening Refused Appointment in IMPACT..." : type === "no-answer" ? "Sending No Answer to IMPACT..." : type === "call" ? `Call ${details.phoneType} sent to IMPACT.` : type === "next"
      ? "Advancing IMPACT on computer..."
      : "Moving IMPACT back on computer...";
    return true;
  } catch (error) {
    statusEl.textContent = /lead changed/i.test(error.message) && ["next", "previous"].includes(type)
      ? "Your phone was still catching up to IMPACT. Check the lead shown and tap again."
      : error.message;
    return false;
  }
}

function renderLead(lead, updatedAt, source) {
  renderCallHistory(lead);
  renderAppointmentPicker(lead);
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
      setPendingCall(createPendingCall({ leadKey: calledLeadKey, leadId: lead.leadId, leadName: lead.leadName, phoneLabel: phone.label, now: Date.now() }));
      renderPendingCallReminder(null);
      document.querySelector("#callHistory").open = false;
      updateNavButtons();
      renderAppointmentPicker(displayedLead);
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
  virtualAppointmentButton.disabled = !callStarted || !displayedLead?.leadId || Boolean(displayedLead?.appointmentOptions);
  refusedAppointmentButton.disabled = !callStarted || !displayedLead?.leadId;
  const navLocked = !displayedLead?.available || navigationPending();
  previousLeadButton.disabled = navLocked;
  nextLeadButton.disabled = navLocked;
}

function renderAppointmentPicker(lead) {
  const options = lead?.appointmentOptions;
  const active = Boolean(lead?.available && calledLeadKey === getLeadKey(lead) && options?.leadId === lead?.leadId && Array.isArray(options.days));
  appointmentPicker.hidden = !active;
  appointmentDays.replaceChildren();
  appointmentTimes.replaceChildren();
  if (!active) return;

  const days = options.days.filter((day) => day?.id && Array.isArray(day.slots));
  if (!days.some((day) => day.id === selectedAppointmentDay)) selectedAppointmentDay = options.selectedDayId || days[0]?.id || "";
  const selectedDay = days.find((day) => day.id === selectedAppointmentDay);
  const ready = selectedDay?.id === options.selectedDayId;
  appointmentHint.textContent = ready ? "Tap an available time to set the appointment." : "Selecting this day in IMPACT…";
  for (const day of days) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = day.label;
    button.className = day.id === selectedAppointmentDay ? "selected" : "";
    button.disabled = !lead.leadId;
    button.addEventListener("click", () => {
      if (day.id === selectedAppointmentDay && ready) return;
      selectedAppointmentDay = day.id;
      renderAppointmentPicker(displayedLead);
      void sendCallResult("virtual-appointment-day", { dayId: day.id });
    });
    appointmentDays.append(button);
  }
  for (const time of selectedDay?.slots || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = time;
    button.disabled = !ready || !lead.leadId;
    button.addEventListener("click", () => void sendCallResult("virtual-appointment-slot", {
      dayId: selectedDay.id, time
    }));
    appointmentTimes.append(button);
  }
}

function renderCallHistory(lead) {
  const card = document.querySelector("#callHistory");
  const entries = document.querySelector("#historyEntries");
  const key = lead?.available ? getLeadKey(lead) : "";
  // Start collapsed when returning to a lead that is mid-call (e.g. after a reload).
  if (key !== historyLeadKey) card.open = !(key && key === calledLeadKey);
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
