const statusEl = document.querySelector("#status");
const leadCard = document.querySelector("#leadCard");
const bridgeUrlInput = document.querySelector("#bridgeUrl");
const bridgeTokenInput = document.querySelector("#bridgeToken");
const saveBridgeButton = document.querySelector("#saveBridge");
const params = new URLSearchParams(location.search);

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

    renderLead(payload.lead, payload.updatedAt);
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

function persistBridgeSettings() {
  localStorage.setItem("impact.bridgeUrl", bridgeUrlInput.value.trim());
  localStorage.setItem("impact.bridgeToken", bridgeTokenInput.value.trim());
}

function renderLead(lead, updatedAt) {
  if (!lead?.available) {
    leadCard.className = "leadCard empty";
    leadCard.textContent = "Send a lead from the Brave extension.";
    statusEl.textContent = "No current lead.";
    return;
  }

  statusEl.textContent = updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : "Lead loaded.";
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
