const statusEl = document.querySelector("#status");
const leadCard = document.querySelector("#leadCard");
const nextLeadCard = document.querySelector("#nextLeadCard");
const bridgeUrlInput = document.querySelector("#bridgeUrl");
const bridgeTokenInput = document.querySelector("#bridgeToken");
const saveBridgeButton = document.querySelector("#saveBridge");
const previousLeadButton = document.querySelector("#previousLead");
const nextLeadButton = document.querySelector("#nextLead");
const params = new URLSearchParams(location.search);

let bridgeLead = null;
let displayedLead = null;
let previousLeads = [];
let displayedLeadKey = "";

const savedBridgeUrl = localStorage.getItem("impact.bridgeUrl") || "";
const savedBridgeToken = localStorage.getItem("impact.bridgeToken") || "";
bridgeUrlInput.value = params.get("bridge") || savedBridgeUrl || location.origin;
bridgeTokenInput.value = params.get("token") || savedBridgeToken || "";

persistBridgeSettings();

saveBridgeButton.addEventListener("click", () => {
  localStorage.setItem("impact.bridgeUrl", bridgeUrlInput.value.trim());
  localStorage.setItem("impact.bridgeToken", bridgeTokenInput.value.trim());
  refreshLead();
});

bridgeUrlInput.addEventListener("input", persistBridgeSettings);
bridgeTokenInput.addEventListener("input", persistBridgeSettings);
previousLeadButton.addEventListener("click", showPreviousLead);
nextLeadButton.addEventListener("click", showNextLead);

refreshLead();
setInterval(refreshLead, 2500);

async function refreshLead() {
  try {
    const bridgeUrl = bridgeUrlInput.value.trim().replace(/\/$/, "");
    const token = bridgeTokenInput.value.trim();
    if (!bridgeUrl || !token) {
      statusEl.textContent = "Bridge URL and token required once. Then updates are automatic.";
      return;
    }

    const response = await fetch(`${bridgeUrl}/api/current-lead?token=${encodeURIComponent(token)}`, {
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    receiveBridgeLead(payload.lead, payload.updatedAt);
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

function persistBridgeSettings() {
  localStorage.setItem("impact.bridgeUrl", bridgeUrlInput.value.trim());
  localStorage.setItem("impact.bridgeToken", bridgeTokenInput.value.trim());
}

function receiveBridgeLead(lead, updatedAt) {
  bridgeLead = lead;
  if (!lead?.available) {
    displayedLead = null;
    displayedLeadKey = "";
    previousLeads = [];
    renderLead(null, updatedAt, "bridge");
    return;
  }

  const nextKey = getLeadKey(lead);
  if (!displayedLead || nextKey !== displayedLeadKey) {
    displayedLead = lead;
    displayedLeadKey = nextKey;
    previousLeads = [];
  }

  renderLead(displayedLead, updatedAt, displayedLead === bridgeLead ? "bridge" : "local");
}

function showNextLead() {
  if (!displayedLead?.nextLead?.available) {
    return;
  }

  previousLeads.push(displayedLead);
  displayedLead = displayedLead.nextLead;
  displayedLeadKey = getLeadKey(displayedLead);
  renderLead(displayedLead, null, "local");
}

function showPreviousLead() {
  const previous = previousLeads.pop();
  if (!previous) {
    return;
  }

  displayedLead = previous;
  displayedLeadKey = getLeadKey(displayedLead);
  renderLead(displayedLead, null, displayedLead === bridgeLead ? "bridge" : "local");
}

function renderLead(lead, updatedAt, source) {
  if (!lead?.available) {
    leadCard.className = "leadCard empty";
    leadCard.textContent = "Send a lead from the Brave extension.";
    renderNextLead(null);
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
    link.textContent = `Call ${phone.label}: ${phone.number}`;
    phoneList.append(link);
  }
  leadCard.append(phoneList);
  renderNextLead(lead.nextLead);
  updateNavButtons();
}

function renderNextLead(nextLead) {
  nextLeadCard.replaceChildren();

  if (!nextLead?.available) {
    nextLeadCard.className = "nextStatus empty";
    nextLeadCard.textContent = nextLead?.error
      ? `Next preload unavailable: ${nextLead.error}`
      : "No preloaded next lead yet.";
    return;
  }

  nextLeadCard.className = "nextStatus ready";

  const label = document.createElement("div");
  label.className = "nextLabel";
  label.textContent = "Next lead ready";

  const meta = document.createElement("div");
  meta.className = "nextMeta";
  meta.textContent = nextLead.prefetchedAt
    ? `Preloaded ${new Date(nextLead.prefetchedAt).toLocaleTimeString()}`
    : "Preloaded in background";

  nextLeadCard.append(label, meta);
}

function updateNavButtons() {
  previousLeadButton.disabled = previousLeads.length === 0;
  nextLeadButton.disabled = !displayedLead?.nextLead?.available;
}

function getLeadKey(lead) {
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
  row.textContent = `${label}: ${value}`;
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
