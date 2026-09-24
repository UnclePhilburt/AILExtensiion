import { DEFAULT_ALLOWED_ORIGINS, DEFAULT_SELECTOR_CONFIG } from "../shared/selector-config.js";
import { STORAGE_KEYS } from "../shared/storage-keys.js";

const allowedOriginsInput = document.querySelector("#allowedOrigins");
const selectorConfigInput = document.querySelector("#selectorConfig");
const bridgeUrlInput = document.querySelector("#bridgeUrl");
const bridgeTokenInput = document.querySelector("#bridgeToken");
const statusOutput = document.querySelector("#status");
const lastPickedOutput = document.querySelector("#lastPicked");
const saveButton = document.querySelector("#save");
const resetButton = document.querySelector("#reset");

init();

saveButton.addEventListener("click", saveOptions);
resetButton.addEventListener("click", resetDefaults);

async function init() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.allowedOrigins,
    STORAGE_KEYS.selectorConfig,
    STORAGE_KEYS.bridgeUrl,
    STORAGE_KEYS.bridgeToken,
    "impact.lastPickedElement"
  ]);

  allowedOriginsInput.value = (result[STORAGE_KEYS.allowedOrigins] || DEFAULT_ALLOWED_ORIGINS).join("\n");
  selectorConfigInput.value = JSON.stringify(result[STORAGE_KEYS.selectorConfig] || DEFAULT_SELECTOR_CONFIG, null, 2);
  bridgeUrlInput.value = result[STORAGE_KEYS.bridgeUrl] || "http://127.0.0.1:8787";
  bridgeTokenInput.value = result[STORAGE_KEYS.bridgeToken] || "";
  lastPickedOutput.textContent = result["impact.lastPickedElement"]
    ? JSON.stringify(result["impact.lastPickedElement"], null, 2)
    : "No element picked yet.";
}

async function saveOptions() {
  try {
    const allowedOrigins = parseOrigins(allowedOriginsInput.value);
    const selectorConfig = JSON.parse(selectorConfigInput.value);
    validateSelectorConfig(selectorConfig);

    await chrome.storage.local.set({
      [STORAGE_KEYS.allowedOrigins]: allowedOrigins,
      [STORAGE_KEYS.selectorConfig]: selectorConfig,
      [STORAGE_KEYS.bridgeUrl]: parseBridgeUrl(bridgeUrlInput.value),
      [STORAGE_KEYS.bridgeToken]: bridgeTokenInput.value.trim()
    });

    setStatus("Saved.");
  } catch (error) {
    setStatus(`Could not save: ${error.message}`, true);
  }
}

async function resetDefaults() {
  allowedOriginsInput.value = DEFAULT_ALLOWED_ORIGINS.join("\n");
  selectorConfigInput.value = JSON.stringify(DEFAULT_SELECTOR_CONFIG, null, 2);
  bridgeUrlInput.value = "http://127.0.0.1:8787";
  setStatus("Defaults restored in the editor. Click Save to apply.");
}

function parseOrigins(value) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((origin) => {
      const parsed = new URL(origin);
      if (parsed.origin !== origin) {
        throw new Error(`Use origin only, not a full path: ${origin}`);
      }
      return parsed.origin;
    });
}

function validateSelectorConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("Selector config must be a JSON object.");
  }

  if (!Array.isArray(config.fields)) {
    throw new Error("Selector config must include a fields array.");
  }
}

function parseBridgeUrl(value) {
  const bridgeUrl = value.trim() || "http://127.0.0.1:8787";
  const parsed = new URL(bridgeUrl);
  if (!["http:"].includes(parsed.protocol)) {
    throw new Error("Phone bridge URL must be local HTTP for this prototype.");
  }
  return parsed.origin;
}

function setStatus(message, isError = false) {
  statusOutput.textContent = message;
  statusOutput.style.color = isError ? "#b91c1c" : "#166534";
}
