import { DEFAULT_ALLOWED_ORIGINS, DEFAULT_SELECTOR_CONFIG } from "../shared/selector-config.js";
import { STORAGE_KEYS } from "../shared/storage-keys.js";
import { parseBridgeUrl } from "../shared/bridge-config.js";
import { client, accessToken } from '../shared/auth-runtime.js';

try { await accessToken(); } catch { location.replace('../account/account.html'); throw new Error('Sign-in required'); }
document.querySelector('main').hidden = false;
const { data: accountData } = await client.auth.getSession();
document.querySelector('#accountEmail').textContent = accountData.session?.user?.email || '';
document.querySelector('#teamAdminLink').hidden = accountData.session?.user?.email?.toLowerCase() !== 'cody2931@gmail.com';
chrome.storage.onChanged.addListener((changes) => {
  if (changes['impact.supabase.session'] && !changes['impact.supabase.session'].newValue) location.replace('../account/account.html');
  if (changes['impact.lastPickedElement']) document.querySelector('#lastPicked').textContent = JSON.stringify(changes['impact.lastPickedElement'].newValue, null, 2);
});
for (const button of document.querySelectorAll('nav button')) {
  button.addEventListener('click', () => {
    for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== button.dataset.panel;
    for (const tab of document.querySelectorAll('nav button')) tab.setAttribute('aria-pressed', String(tab === button));
  });
}

const allowedOriginsInput = document.querySelector("#allowedOrigins");
const selectorConfigInput = document.querySelector("#selectorConfig");
const bridgeUrlInput = document.querySelector("#bridgeUrl");
const bridgeTokenInput = document.querySelector("#bridgeToken");
const autoPublishInput = document.querySelector("#autoPublish");
const statusOutput = document.querySelector("#status");
const lastPickedOutput = document.querySelector("#lastPicked");
const saveButton = document.querySelector("#save");
const resetButton = document.querySelector("#reset");
const connectionMode = document.querySelector('#connectionMode');
connectionMode.addEventListener('change', () => { document.querySelector('#localSettings').hidden = connectionMode.value !== 'local'; });

init();
void refreshDebugTabs();
document.querySelector('#refreshTabs').addEventListener('click', refreshDebugTabs);
document.querySelector('#runDiagnostic').addEventListener('click', event => runDebug(event.currentTarget, 'impact/getSnapshot'));
document.querySelector('#pickElement').addEventListener('click', event => runDebug(event.currentTarget, 'impact/startPicker'));
document.querySelector('#loadLogs').addEventListener('click', loadDebugLogs);
document.querySelector('#clearLogs').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({type:'impact/clearLogs'});
  await loadDebugLogs();
});

async function refreshDebugTabs() {
  const tabs = await chrome.tabs.query({url:'https://mobile.impact.ailife.com/*'});
  const saved = await chrome.storage.session.get('impact.debugTabId');
  const select = document.querySelector('#debugTab');
  select.replaceChildren();
  for (const tab of tabs) {
    const option = document.createElement('option');
    option.value = String(tab.id);
    option.textContent = `${tab.title || 'IMPACT'} (tab ${tab.id})`;
    select.append(option);
    if (tab.id === saved['impact.debugTabId']) option.selected = true;
  }
}
async function runDebug(button, type) {
  button.disabled = true;
  try {
    const tabId = Number(document.querySelector('#debugTab').value);
    if (!tabId) throw new Error('Open IMPACT and refresh the tab list first.');
    await chrome.scripting.executeScript({target:{tabId},files:['src/content/selector-config.js','src/content/impact-diagnostic.js']});
    if (type === 'impact/startPicker') await chrome.tabs.update(tabId,{active:true});
    const response = await chrome.tabs.sendMessage(tabId,{type});
    if (!response?.ok) throw new Error(response?.error || 'IMPACT did not respond.');
    if (response.snapshot) document.querySelector('#snapshotOutput').textContent = JSON.stringify(response.snapshot,null,2);
    setStatus(type === 'impact/startPicker' ? 'Select an element in IMPACT, then return to Debug tools.' : 'Diagnostic complete.');
  } catch (error) { setStatus(error.message,true); }
  finally { button.disabled = false; }
}
async function loadDebugLogs() {
  try {
    const response = await chrome.runtime.sendMessage({type:'impact/getLogs'});
    document.querySelector('#logOutput').textContent = JSON.stringify(response.logs || [],null,2);
  } catch (error) { setStatus(error.message,true); }
}

saveButton.addEventListener("click", saveOptions);
resetButton.addEventListener("click", resetDefaults);

async function init() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.allowedOrigins,
    STORAGE_KEYS.selectorConfig,
    STORAGE_KEYS.bridgeUrl,
    STORAGE_KEYS.bridgeToken,
    STORAGE_KEYS.autoPublish,
    "impact.lastPickedElement"
    , "impact.connectionMode"
  ]);

  allowedOriginsInput.value = (result[STORAGE_KEYS.allowedOrigins] || DEFAULT_ALLOWED_ORIGINS).join("\n");
  selectorConfigInput.value = JSON.stringify(result[STORAGE_KEYS.selectorConfig] || DEFAULT_SELECTOR_CONFIG, null, 2);
  bridgeUrlInput.value = result[STORAGE_KEYS.bridgeUrl] || "http://127.0.0.1:8787";
  bridgeTokenInput.value = result[STORAGE_KEYS.bridgeToken] || "";
  connectionMode.value = result['impact.connectionMode'] || 'cloud';
  document.querySelector('#localSettings').hidden = connectionMode.value !== 'local';
  autoPublishInput.checked = result[STORAGE_KEYS.autoPublish] !== false;
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
      'impact.connectionMode': connectionMode.value,
      [STORAGE_KEYS.allowedOrigins]: allowedOrigins,
      [STORAGE_KEYS.selectorConfig]: selectorConfig,
      [STORAGE_KEYS.bridgeUrl]: parseBridgeUrl(bridgeUrlInput.value),
      [STORAGE_KEYS.bridgeToken]: bridgeTokenInput.value.trim(),
      [STORAGE_KEYS.autoPublish]: autoPublishInput.checked
    });

    setStatus("Saved. Refresh your IMPACT tab to apply the connection change.");
  } catch (error) {
    setStatus(`Could not save: ${error.message}`, true);
  }
}

async function resetDefaults() {
  connectionMode.value = 'cloud';
  document.querySelector('#localSettings').hidden = true;
  allowedOriginsInput.value = DEFAULT_ALLOWED_ORIGINS.join("\n");
  selectorConfigInput.value = JSON.stringify(DEFAULT_SELECTOR_CONFIG, null, 2);
  bridgeUrlInput.value = "http://127.0.0.1:8787";
  autoPublishInput.checked = true;
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

function setStatus(message, isError = false) {
  statusOutput.textContent = message;
  statusOutput.style.color = isError ? "#b91c1c" : "#166534";
}
