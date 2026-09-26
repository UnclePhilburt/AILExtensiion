import { buildLeadProfile } from './lead-profile.js';
import { installLeadSwipe } from './lead-swipe.js';
import { client, accessToken } from './auth-runtime.js';
import { cloudEnabled, cloudState, cloudTouchPhone, cloudSend, watchCloud, visibleLead, isOnline } from './cloud-sync.js';
import { NETWORK_MESSAGE, SIGN_IN_MESSAGE, RESULT_COMMANDS, checkBeforeSend, isStateFresh, isAuthFailure, isNetworkFailure, friendlySendError, withTimeout } from './phone-actions.js';
import { buildHeadsUp, splitHistory, localTimeNote } from './lead-highlights.js';
import { doNotKnockWarning, requestTypeLabel } from './lead-rules.js';
import { loadPhoneSettings } from './settings-store.js';
import { saveLeadSchedule, saveAppointmentChoice } from './calendar-sync.js';
import { encourageLead, encourageResult } from './encouragement-ui.js';
import { leadTransitionKind, snapshotLeadCard, playLeadTransition } from './lead-transition.js';
import { createPendingCall, readPendingCall, writePendingCall, pendingCallDecision, markPendingCallResult, isCallResultCommand } from './pending-call.js';
import { findBestCallingTime } from './timing-insights.js';
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
const actionFeedback = document.querySelector("#actionFeedback");
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
let currentCloudState = null, stopCloudWatch = null, cloudReadBusy = 0, lastCloudResult = '', lastPhoneTouch = 0;
// When the phone last fetched cloud state and when the page was last hidden.
// Phone browsers pause timers and live updates in the background, so a tap right
// after coming back must not trust state fetched before the phone went away.
let lastCloudFetchAt = 0, lastHiddenAt = 0, lastResumeAt = 0;
let awaitingResultSince = 0, feedbackTimer = null;
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
// Lead-change animation (presentation only, see lead-transition.js): the last
// lead shown on the card and the Next/Previous tap that may explain a change.
let lastShownLeadKey = "";
let navIntent = null;
let timingOutcomes = null;
let timingOutcomesFetchedAt = 0;
// A quiet-hours lead is only skipped once. If IMPACT does not move, keep the
// card available instead of repeatedly sending Next in a loop.
let quietHoursSkippedLeadKey = "";

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
installLeadSwipe(leadCard, {
  enabled: () => signedIn && displayedLead?.available && loadPhoneSettings(localStorage).swipeLeads && !navigationPending() && pendingCall?.leadKey === getLeadKey(displayedLead) && !pendingCall?.resultSentAt && !awaitingResultSince && !leadCard.querySelector(".profileBio[open]") && !displayedLead?.appointmentOptions,
  currentKey: () => displayedLeadKey,
  navigate: (direction) => {
    if (direction === 'callback') { showFeedback('Callback scheduling is not connected yet. Set it in IMPACT on your computer.'); return; }
    if (direction === 'refused' && !globalThis.confirm('Record Refused Appointment for ' + (displayedLead?.leadName || 'this lead') + '?')) return;
    return sendCallResult(direction === 'next' ? 'no-answer' : direction === 'refused' ? 'refused-appointment' : 'virtual-appointment');
  }
});
noAnswerButton.addEventListener("click", () => sendCallResult("no-answer"));
virtualAppointmentButton.addEventListener("click", () => sendCallResult("virtual-appointment"));
refusedAppointmentButton.addEventListener("click", () => confirmResult("Refused Appointment") ? sendCallResult("refused-appointment") : false);
dismissPendingCallButton.addEventListener("click", dismissPendingCall);

client.auth.onAuthStateChange((_event, session) => {
  signedIn = Boolean(session);
  const userId = signedIn ? String(session.user?.id || "") : "";
  if (userId !== currentUserId) {
    currentUserId = userId;
    timingOutcomes = null;
    timingOutcomesFetchedAt = 0;
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
  if (document.hidden) lastHiddenAt = Date.now();
  else resumePage();
});
// pageshow covers pages restored from the back/forward cache; focus and online
// cover returning from another app or regaining signal.
globalThis.addEventListener?.("pagehide", () => { lastHiddenAt = Date.now(); });
globalThis.addEventListener?.("pageshow", () => resumePage());
globalThis.addEventListener?.("focus", () => resumePage());
globalThis.addEventListener?.("online", () => resumePage(true));

function resumePage(force = false) {
  if (!signedIn || document.hidden) return;
  if (!force && Date.now() - lastResumeAt < 1500) return;
  lastResumeAt = Date.now();
  // Let the Supabase client refresh an access token that expired while away.
  void client.auth.getSession?.().catch?.(() => {});
  // Locks such as Previous/Next expire by time; re-evaluate them right away.
  updateNavButtons();
  void connectLiveUpdates();
}

function showFeedback(message, kind = "info", ms = 9000) {
  if (!message) return;
  statusEl.textContent = message;
  actionFeedback.textContent = message;
  actionFeedback.className = `actionFeedback ${kind}`;
  actionFeedback.hidden = false;
  globalThis.clearTimeout?.(feedbackTimer);
  feedbackTimer = setTimeout(() => { actionFeedback.hidden = true; }, ms);
}

function commandProgressMessage(type, details = {}) {
  if (type === "call") return `Connecting your ${details.phoneType || "phone"} call…`;
  if (type === "no-answer") return "Logging No Answer…";
  if (type === "refused-appointment") return "Logging Refused Appointment…";
  if (type === "virtual-appointment") return "Opening Virtual Appointment…";
  if (type === "virtual-appointment-day") return "Selecting appointment day…";
  if (type === "virtual-appointment-slot") return "Setting appointment time…";
  if (type === "best-next") return "Finding the best lead to call…";
  return type === "next" ? "Moving to the next lead…" : "Moving to the previous lead…";
}

async function connectLiveUpdates() {
  if (!signedIn) return;
  if (useCloud) {
    const generation = ++cloudGeneration;
    stopCloudWatch?.(); stopCloudWatch = null;
    try {
      const stop = await watchCloud(() => { void refreshCloud(); }, (status) => cloudChannelStatus(status, generation));
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
        if (frame.includes('event: command-result')) receiveComputerResult(payload.message);
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

// Live updates can drop (phone asleep, signal lost) and reconnect without
// replaying what changed meanwhile: fetch the lead every time the channel
// (re)subscribes, and rebuild a channel that failed.
function cloudChannelStatus(status, generation) {
  if (!signedIn || generation !== cloudGeneration) return;
  if (status === "SUBSCRIBED") { void refreshCloud(); return; }
  if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
    setTimeout(() => { if (signedIn && generation === cloudGeneration && !document.hidden) void connectLiveUpdates(); }, 3000);
  }
}

// After a result that moves IMPACT to the next lead, keep checking for the new
// lead until it shows up (on top of live updates and the 5-second poll).
const LEAD_ADVANCING_RESULTS = ["no-answer", "refused-appointment", "virtual-appointment-slot"];
const RESULT_FOLLOW_DELAYS = [2000, 4000, 7000, 10000, 15000, 20000, 30000];
let resultFollow = null;
function followLeadAfterResult(type) {
  if (!LEAD_ADVANCING_RESULTS.includes(type)) return;
  const follow = { fromKey: displayedLeadKey };
  resultFollow = follow;
  for (const delay of RESULT_FOLLOW_DELAYS) {
    setTimeout(() => {
      if (resultFollow !== follow || displayedLeadKey !== follow.fromKey || document.hidden) return;
      void refreshLead();
    }, delay);
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
  if (!signedIn) return;
  // A read started before the phone went to sleep can stay pending for a long
  // time. Don't let it block fresh reads forever.
  if (cloudReadBusy && Date.now() - cloudReadBusy < 15000) return;
  const startedAt = Date.now();
  cloudReadBusy = startedAt;
  const generation = cloudGeneration;
  try {
    const state = await cloudState();
    if (!signedIn || generation !== cloudGeneration) return;
    applyCloudState(state, startedAt);
    if (Date.now() - lastPhoneTouch > 10000) { lastPhoneTouch = Date.now(); await cloudTouchPhone(); }
  } catch (error) {
    if (!signedIn || generation !== cloudGeneration || startedAt < lastCloudFetchAt) return;
    if (isNetworkFailure(error.message) && currentCloudState) {
      // Signal is often still coming back right after the phone wakes. Keep the
      // lead on screen; the next poll or tap fetches again.
      statusEl.textContent = "Reconnecting…";
      return;
    }
    currentCloudState = null; receiveBridgeLead(null, null); statusEl.textContent = error.message;
  } finally { if (cloudReadBusy === startedAt) cloudReadBusy = 0; }
}

function applyCloudState(state, startedAt) {
  // Never let an older response overwrite a newer one.
  if (startedAt < lastCloudFetchAt) return false;
  lastCloudFetchAt = startedAt;
  currentCloudState = state;
  receiveBridgeLead(visibleLead(state), state?.lead_updated_at);
  if (!isOnline(state?.desktop_seen)) statusEl.textContent = 'Open IMPACT on your computer to connect.';
  else if (!visibleLead(state)) {
    statusEl.textContent = "Your computer is connected but hasn't sent a lead recently.";
    leadCard.textContent = "Your computer is connected, but IMPACT hasn't sent a current lead. Open the lead in IMPACT on your computer." +
      (pendingCall ? ` Your call to ${pendingCall.leadName || "your last lead"} is saved.` : "");
  }
  const result = state?.result;
  if (result?.at && result.at !== lastCloudResult) {
    lastCloudResult = result.at;
    // result.at comes from the computer's clock, so also accept a result that
    // shows up while the phone is waiting for one.
    const awaiting = awaitingResultSince && Date.now() - awaitingResultSince < 60000;
    if (awaiting || Date.now() - Date.parse(result.at) < 15000) { receiveComputerResult(result.message); }
  }
  return true;
}

function receiveComputerResult(message) {
  awaitingResultSince = 0;
  showFeedback(message, /skipped|not |no longer|unavailable|could not|couldn't|expired|failed|needs|disabled|open |check /i.test(message) ? "error" : "info");
  clearNavigationPending();
}

// Cloud state for a send: reuse it only if it was fetched after the phone
// last came back from the background and is only a few seconds old.
async function stateForSend() {
  if (currentCloudState && isStateFresh(lastCloudFetchAt, lastHiddenAt, Date.now())) return currentCloudState;
  const startedAt = Date.now();
  await ensureSession();
  const state = await withTimeout(cloudState(), 10000, NETWORK_MESSAGE);
  if (!signedIn) throw new Error(SIGN_IN_MESSAGE);
  applyCloudState(state, startedAt);
  return state;
}

async function ensureSession() {
  try {
    const { data } = await withTimeout(client.auth.getSession(), 10000, NETWORK_MESSAGE);
    if (data?.session) return;
  } catch (error) {
    if (isNetworkFailure(error.message)) throw new Error(NETWORK_MESSAGE);
  }
  if (!(await refreshSessionNow())) throw new Error(SIGN_IN_MESSAGE);
}

async function refreshSessionNow() {
  try {
    const { data } = await withTimeout(client.auth.refreshSession(), 10000, NETWORK_MESSAGE);
    return Boolean(data?.session);
  } catch (_error) {
    return false;
  }
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
    encourageLead("");
    return;
  }

  const nextKey = getLeadKey(lead);
  // Decided here, played after the render; state below updates immediately either way.
  const transition = leadTransitionKind(lastShownLeadKey, nextKey, navIntent, Date.now());
  if (nextKey !== lastShownLeadKey) { lastShownLeadKey = nextKey; navIntent = null; }
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
  // Calendar (Cloud mode only; Local mode keeps lead data off the cloud): save the
  // lead's scheduled appointment/callback. Never blocks or breaks the Workspace.
  if (useCloud) void saveLeadSchedule(lead).catch(() => {});

  renderLead(displayedLead, updatedAt, displayedLead === bridgeLead ? "bridge" : "local", transition);
  // Header encouragement line: a fresh one only when the lead itself changes.
  encourageLead(nextKey);
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
    showFeedback(displayedLead?.available && !call
      ? "Tap Call on this lead first, then choose the result."
      : "This result belongs to a different lead than the one on screen. Check the lead and try again.", "error");
    return false;
  }
  const sent = await sendComputerCommand(type, { ...details, leadId: call.leadId });
  if (sent) { tapAccepted(); navIntent = null; }
  // A short, gentle message for No Answer / Refused / an appointment set (Settings can turn it off).
  if (sent) encourageResult(type);
  if (sent && isCallResultCommand(type) && pendingCall === call) setPendingCall(markPendingCallResult(call, Date.now()));
  return sent;
}

// Settings page: "Confirm before Refused Appointment" (on by default).
function confirmResult(label) {
  if (!loadPhoneSettings(localStorage).confirmResults || typeof globalThis.confirm !== "function") return true;
  return globalThis.confirm(`Send ${label} to IMPACT for ${displayedLead?.leadName || "this lead"}?`);
}

// Settings page: "Vibrate when a tap is sent" (on by default; iPhone browsers can't vibrate).
function tapAccepted() {
  if (!loadPhoneSettings(localStorage).vibrate) return;
  try { globalThis.navigator?.vibrate?.(40); } catch (_error) { /* vibration is optional */ }
}

// Settings page: "Best next lead" (off by default) turns Next into Best next
// and hides Previous (settings-boot.js sets html[data-best-next] for the layout).
async function showNextLead() {
  await sendNavigation(loadPhoneSettings(localStorage).bestNextLead ? "best-next" : "next");
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
  if (!displayedLead?.available) { showFeedback("No lead is showing yet. Open IMPACT on your computer.", "error"); return; }
  if (navigationPending()) { showFeedback("Still waiting for IMPACT to move. One moment…"); return; }
  const pending = { until: Date.now() + 10000 };
  navPending = pending;
  navIntent = { type, at: Date.now() };
  updateNavButtons();
  const sent = await sendComputerCommand(type);
  if (sent) tapAccepted();
  if (navPending !== pending) return;
  if (!sent) {
    navPending = null;
    navIntent = null;
    updateNavButtons();
    if (useCloud) void refreshCloud();
    return;
  }
  // Pick up the new lead promptly even if the live update is slow.
  for (const delay of [700, 1800, 4000]) setTimeout(() => { if (navPending === pending) void refreshLead(); }, delay);
  setTimeout(() => {
    if (navPending !== pending) return;
    navIntent = null;
    clearNavigationPending();
    if (!document.hidden) showFeedback(type === "best-next" ? "IMPACT could not choose a lead. Open your Inbox on the computer so Companion can refresh the list, then try again." : `IMPACT didn't move to the ${type === "next" ? "next" : "previous"} lead. Check IMPACT on your computer, then try again.`, "error");
  }, 10100);
}

async function sendComputerCommand(type, details = {}) {
  if (!signedIn) { showFeedback("You're signed out. Sign in again to continue.", "error"); return false; }
  showFeedback(commandProgressMessage(type, details), "loading", 12000);
  try {
    if (useCloud) {
      const command = { type, leadId: displayedLead?.leadId, ...details };
      const state = await stateForSend();
      const problem = checkBeforeSend(state, command, Date.now());
      if (problem) throw new Error(problem);
      // The same id on a retry lets the server ignore a duplicate.
      const id = crypto.randomUUID();
      try {
        await withTimeout(cloudSend(state, command, id), 12000, NETWORK_MESSAGE);
      } catch (error) {
        if (!isAuthFailure(error.message)) throw error;
        if (!(await refreshSessionNow())) throw new Error(SIGN_IN_MESSAGE);
        await withTimeout(cloudSend(state, command, id), 12000, NETWORK_MESSAGE);
      }
      showFeedback(type === 'call' ? 'Call sent to IMPACT.' : type === 'virtual-appointment' ? 'Opening Virtual Appointment in IMPACT…' : type === 'virtual-appointment-day' ? 'Selecting that day in IMPACT…' : type === 'virtual-appointment-slot' ? 'Setting that appointment in IMPACT…' : type === 'refused-appointment' ? 'Sending Refused Appointment to IMPACT…' : type === 'no-answer' ? 'Sending No Answer to IMPACT…' : type === 'previous' ? 'Moving IMPACT back on computer…' : type === 'next' ? 'Advancing IMPACT on computer…' : type === 'best-next' ? 'Finding your best next lead…' : 'Action sent to your computer…', "loading", 4000);
      expectComputerResult(type);
      followLeadAfterResult(type);
      return true;
    }
    const bridgeUrl = bridgeUrlInput.value.trim().replace(/\/$/, "");
    const token = bridgeTokenInput.value.trim();
    if (!bridgeUrl || !token) {
      showFeedback("Bridge URL and token required.", "error");
      return false;
    }

    const response = await withTimeout(fetch(`${bridgeUrl}/api/command?token=${encodeURIComponent(token)}`, {
      method: "POST",
      keepalive: true,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ type, ...details })
    }), 12000, NETWORK_MESSAGE);
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    showFeedback(type === "virtual-appointment" ? "Opening Virtual Appointment in IMPACT..." : type === "virtual-appointment-day" ? "Selecting that day in IMPACT..." : type === "virtual-appointment-slot" ? "Setting that appointment in IMPACT..." : type === "refused-appointment" ? "Opening Refused Appointment in IMPACT..." : type === "no-answer" ? "Sending No Answer to IMPACT..." : type === "call" ? `Call ${details.phoneType} sent to IMPACT.` : type === "next"
      ? "Advancing IMPACT on computer..."
      : "Moving IMPACT back on computer...", "loading", 4000);
    if (eventsConnected) expectComputerResult(type);
    followLeadAfterResult(type);
    return true;
  } catch (error) {
    showFeedback(friendlySendError(error.message, type), "error");
    return false;
  }
}

// The computer reports back after every call result. If nothing arrives, the
// command most likely expired unseen (IMPACT tab closed, hidden or asleep).
function expectComputerResult(type) {
  if (!RESULT_COMMANDS.includes(type)) return;
  const since = Date.now();
  awaitingResultSince = since;
  setTimeout(() => {
    if (awaitingResultSince !== since || document.hidden) return;
    showFeedback("Your computer hasn't confirmed that yet. Make sure the IMPACT tab is open and in front on your computer, then tap again if nothing happened.", "error", 15000);
  }, 16000);
}

function scheduleQuietHoursSkip(lead, quietHoursWarning) {
  const settings = loadPhoneSettings(localStorage);
  const leadKey = getLeadKey(lead);
  if (!settings.autoSkipQuietHours || !quietHoursWarning) {
    // Let a rep turn the switch on for the currently visible lead without
    // having to navigate away and back first.
    if (!settings.autoSkipQuietHours) quietHoursSkippedLeadKey = "";
    return;
  }
  if (!leadKey || quietHoursSkippedLeadKey === leadKey || navigationPending()) return;
  quietHoursSkippedLeadKey = leadKey;
  setTimeout(() => {
    if (!loadPhoneSettings(localStorage).autoSkipQuietHours) return;
    if (getLeadKey(displayedLead) !== leadKey || !doNotKnockWarning(displayedLead)) return;
    void sendNavigation("next");
  }, 0);
}

function renderLead(lead, updatedAt, source, transition = "") {
  const historyCard = document.querySelector("#callHistory");
  const bioOpen = leadCard.dataset.profileKey === getLeadKey(lead) && Boolean(leadCard.querySelector(".profileBio[open]"));
  const resultsOpen = leadCard.dataset.profileKey === getLeadKey(lead) && Boolean(leadCard.querySelector(".profileResultMenu[open]"));
  document.querySelector(".wsBody").append(historyCard, callResults);
  renderCallHistory(lead);
  renderAppointmentPicker(lead);
  if (!lead?.available) {
    leadCard.className = "leadCard empty";
    leadCard.textContent = pendingCall
      ? `Waiting for your computer. Your call to ${pendingCall.leadName || "your last lead"} is saved, and the result buttons will come back when IMPACT reconnects.`
      : "Send a lead from the Brave extension.";
    updateNavButtons();
    statusEl.textContent = "No current lead.";
    return;
  }

  statusEl.textContent = updatedAt
    ? `Updated ${new Date(updatedAt).toLocaleTimeString()}`
    : source === "local"
      ? "Loaded from phone preload."
      : "Lead loaded.";
  const outgoing = transition ? safely(() => snapshotLeadCard(leadCard)) : null;
  leadCard.className = "leadCard";
  leadCard.replaceChildren();

  if (lead.requestType) {
    const badge = document.createElement("div");
    badge.className = "requestBadge";
    badge.textContent = requestTypeLabel(lead.requestType);
    badge.title = lead.requestType;
    leadCard.append(badge);
  }
  const quietHoursWarning = doNotKnockWarning(lead);
  if (quietHoursWarning) {
    const warning = document.createElement("section");
    warning.className = "quietHoursFlag";
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    title.textContent = quietHoursWarning.title;
    detail.textContent = quietHoursWarning.detail;
    warning.append(title, detail);
    leadCard.append(warning);
  }
  scheduleQuietHoursSkip(lead, quietHoursWarning);
  const name = document.createElement("h2");
  name.textContent = lead.leadName || "Current lead";
  leadCard.append(name);
  renderHeadsUp(lead);
  renderTimingInsight(lead);

  // English is the usual case, so only spend screen space on language when
  // the caller needs to know something different.
  if (!/^english(?:\s*\([^)]*\))?$/i.test(String(lead.language || "").trim())) {
    appendDetail("Language", lead.language);
  }
  appendDetail("Email", lead.email);
  appendDetail("Address", lead.address);
  renderComments(lead.comments);

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
      const bio = leadCard.querySelector(".profileBio");
      if (bio) bio.open = false;
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
  buildLeadProfile(leadCard, historyCard, lead, bioOpen);
  const resultMenu = document.createElement('details');
  resultMenu.className = 'profileResultMenu';
  resultMenu.open = resultsOpen;
  const resultSummary = document.createElement('summary');
  resultSummary.textContent = 'Choose a result instead';
  resultMenu.append(resultSummary, callResults);
  leadCard.insertBefore(resultMenu, leadCard.querySelector(".profileBio"));
  leadCard.dataset.profileKey = getLeadKey(lead);
  updateNavButtons();
  // The new lead is fully rendered and tappable; the animation only decorates it.
  if (transition) safely(() => playLeadTransition(leadCard, transition, outgoing));
}

function safely(fn) {
  try { return fn(); } catch (_error) { return null; }
}

// Things to know before dialing (upcoming appointment, callback, bad number,
// earlier tries), read from the lead's IMPACT Status history.
function renderHeadsUp(lead) {
  let chips = [];
  try { chips = buildHeadsUp(lead.callHistory, Date.now()); } catch (_error) { chips = []; }
  if (!chips.length) return;
  const section = document.createElement("section");
  section.className = "headsUp";
  section.setAttribute("aria-label", "Heads-up for this lead");
  const scheduled = chips.filter((chip) => (chip.tone === "appointment" || chip.tone === "callback") && !chip.muted);
  if (scheduled.length) {
    section.className += " headsUpPriority";
    const heading = document.createElement("p");
    heading.className = "headsUpHeading";
    heading.textContent = scheduled.length > 1 ? "SCHEDULED NEXT" : scheduled[0].tone === "appointment" ? "SCHEDULED APPOINTMENT" : "SCHEDULED CALLBACK";
    section.append(heading);
  }
  for (const chip of chips) {
    const item = document.createElement("div");
    item.className = `headsUpChip ${chip.tone}${chip.soon ? " soon" : ""}${chip.muted ? " muted" : ""}`;
    const label = document.createElement("span");
    label.className = "headsUpLabel";
    label.textContent = chip.soon && !/today/i.test(chip.label) ? `${chip.label} · soon` : chip.label;
    const title = document.createElement("strong");
    title.className = "headsUpTitle";
    title.textContent = chip.title;
    item.append(label, title);
    if (chip.detail) {
      const detail = document.createElement("span");
      detail.className = "headsUpDetail";
      detail.textContent = chip.detail;
      item.append(detail);
    }
    section.append(item);
  }
  leadCard.append(section);
}

function updateNavButtons() {
  const callStarted = Boolean(displayedLead?.available && calledLeadKey === getLeadKey(displayedLead));
  callResults.hidden = !callStarted;
  leadCard.classList.toggle("profileAfterCall", callStarted);
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
    button.addEventListener("click", async () => {
      const sent = await sendCallResult("virtual-appointment-slot", { dayId: selectedDay.id, time });
      if (sent && useCloud) void saveAppointmentChoice(lead, selectedDay.label, time).catch(() => {});
    });
    appointmentTimes.append(button);
  }
}

function renderCallHistory(lead) {
  const card = document.querySelector("#callHistory");
  const entries = document.querySelector("#historyEntries");
  const key = lead?.available ? getLeadKey(lead) : "";
  // Start collapsed when returning to a lead that is mid-call (e.g. after a reload).
  if (key !== historyLeadKey) card.open = false;
  historyLeadKey = key;
  card.hidden = !lead?.available;
  entries.replaceChildren();
  // One line per IMPACT Status entry, even if its text arrived run together.
  const history = splitHistory(lead?.callHistory);
  document.querySelector("#historyCount").textContent = history.length ? `(${history.length})` : "";
  for (const entry of history.length ? history : ["No previous activity found on this lead."]) {
    const item = document.createElement("li");
    item.textContent = entry;
    appendLocalTimeNote(item, entry);
    entries.append(item);
  }
}

// IMPACT's text shows IMPACT's clock; add the rep's own time beside it when
// the two differ (not on a Central phone), e.g. "… 09:38 PM by Me · 10:38 PM your time" in Eastern.
function appendLocalTimeNote(element, text) {
  let note = "";
  try { note = localTimeNote(text); } catch (_error) { note = ""; }
  if (!note) return;
  const span = document.createElement("span");
  span.className = "localTimeNote";
  span.textContent = ` · ${note}`;
  element.append(span);
}

function renderComments(comments) {
  const values = Array.isArray(comments) ? comments.map(value => String(value || "").trim()).filter(Boolean) : [];
  if (!values.length) return;
  const section = document.createElement("section");
  section.className = "leadNotes";
  section.setAttribute("aria-label", "IMPACT comments");
  const heading = document.createElement("span");
  heading.className = "leadNotesHeading";
  heading.textContent = values.length === 1 ? "IMPACT COMMENT" : "IMPACT COMMENTS";
  section.append(heading);
  for (const value of values) {
    const note = document.createElement("p");
    note.textContent = value;
    appendLocalTimeNote(note, value);
    section.append(note);
  }
  leadCard.append(section);
}

function renderTimingInsight(lead) {
  if (!useCloud) return;
  const leadKey = getLeadKey(lead);
  const section = document.createElement("section");
  section.className = "timingInsight learning";
  section.setAttribute("aria-label", "Personal calling-time insight");
  const label = document.createElement("span");
  label.className = "timingInsightLabel";
  const detail = document.createElement("p");
  label.textContent = "PERSONAL CALLING INSIGHT";
  detail.textContent = "Learning your best calling times from completed calls.";
  section.append(label, detail);
  leadCard.append(section);
  void loadTimingInsight(lead, leadKey, section, detail);
}

async function loadTimingInsight(lead, leadKey, section, detail) {
  try {
    if (!timingOutcomes || Date.now() - timingOutcomesFetchedAt > 10 * 60 * 1000) {
      const since = new Date();
      since.setDate(since.getDate() - 180);
      const { data, error } = await client.from("companion_call_outcomes")
        .select("outcome,request_type,local_hour,created_at")
        .gte("created_at", since.toISOString());
      if (error) throw error;
      timingOutcomes = data || [];
      timingOutcomesFetchedAt = Date.now();
    }
    if (getLeadKey(displayedLead) !== leadKey || !section.isConnected) return;
    const insight = findBestCallingTime(timingOutcomes, lead.requestType);
    if (!insight) return;
    section.classList.remove("learning");
    detail.textContent = `${insight.timeLabel} has been your strongest window for ${insight.scope}: ${insight.reached} reached out of ${insight.total} completed calls (${insight.rate}%).`;
  } catch (_error) {
    // This is optional guidance. A connection or setup issue must never block a lead.
    section.hidden = true;
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
