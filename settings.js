// The Settings page. Every change is saved right away (localStorage) and applied
// to this page; other pages pick it up on load (settings-boot.js).
import { BACKGROUNDS, readBackground, saveBackground } from './backgrounds.js';
import { TEXT_SIZES, ORGANIZATIONS, loadPhoneSettings, savePhoneSettings, resetPhoneSettings } from './settings-store.js';
import { refreshEncouragement } from './encouragement-ui.js';

// Back link: only known pages (never an arbitrary URL from the query string).
const BACK = {
  workspace: ['workspace.html', '← Workspace'],
  'workspace-local': ['workspace.html?mode=local', '← Workspace'],
  home: ['./', '← Home'],
  statistics: ['statistics.html', '← Statistics'],
  calendar: ['calendar.html', '← Calendar']
};
const [backHref, backLabel] = BACK[new URLSearchParams(location.search).get('from')] || BACK.workspace;
const back = document.querySelector('#settingsBack');
back.href = backHref;
back.textContent = backLabel;

const applyToPage = () => globalThis.impactApplySavedSettings?.();
const savedHint = document.querySelector('#savedHint');
let hintTimer = 0;
function saved(message = 'Saved') {
  applyToPage();
  savedHint.textContent = `✓ ${message}`;
  savedHint.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { savedHint.hidden = true; }, 1600);
}

// Background swatches
const bgGrid = document.querySelector('#bgGrid');
for (const option of BACKGROUNDS) {
  const label = document.createElement('label');
  label.className = 'bgOption';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'background';
  input.value = option.id;
  const swatch = document.createElement('span');
  swatch.className = 'bgSwatch';
  swatch.dataset.bgSwatch = option.id;
  swatch.setAttribute('aria-hidden', 'true');
  swatch.innerHTML = '<i></i><i></i>';
  const name = document.createElement('span');
  name.className = 'bgName';
  name.textContent = option.label;
  label.append(input, swatch, name);
  bgGrid.append(label);
}
bgGrid.addEventListener('change', (event) => {
  if (event.target.name !== 'background') return;
  saveBackground(event.target.value, localStorage);
  saved('Background saved');
});

// Text size
const textSize = document.querySelector('#textSize');
for (const size of TEXT_SIZES) {
  const label = document.createElement('label');
  label.className = `segment size-${size.id}`;
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'textSize';
  input.value = size.id;
  const text = document.createElement('span');
  text.textContent = size.label;
  label.append(input, text);
  textSize.append(label);
}
textSize.addEventListener('change', (event) => {
  if (event.target.name !== 'textSize') return;
  savePhoneSettings(localStorage, { textSize: event.target.value });
  saved();
});

const organization = document.querySelector('#organization');
for (const item of ORGANIZATIONS) {
  const option = document.createElement('option');
  option.value = item.id;
  option.textContent = item.label;
  organization.append(option);
}
organization.addEventListener('change', () => {
  savePhoneSettings(localStorage, { organization: organization.value });
  saved('Organization saved');
});

// Switches
const SWITCHES = ['keepAwake', 'vibrate', 'confirmResults', 'showHeadsUp', 'showDoNotKnock', 'showEncouragement', 'encourageAfterResults'];
for (const key of SWITCHES) {
  document.querySelector(`#${key}`).addEventListener('change', (event) => {
    savePhoneSettings(localStorage, { [key]: event.target.checked });
    saved();
    if (key === 'showEncouragement') { renderEncouragementRow(); refreshEncouragement(); }
  });
}

// Features this browser can't do: show the switch as unavailable, with a note.
function unsupported(key, note) {
  const input = document.querySelector(`#${key}`);
  input.disabled = true;
  input.closest('.settingRow').classList.add('unavailable');
  document.querySelector(`#${key}Note`).textContent = note;
}
if (!globalThis.navigator?.wakeLock?.request) {
  unsupported('keepAwake', window.isSecureContext === false
    ? 'Not available on this connection (needs the secure https:// page).'
    : 'Not supported by this browser. Update it, or keep the screen on in your phone settings.');
}
if (typeof globalThis.navigator?.vibrate !== 'function') {
  unsupported('vibrate', 'This browser can\u2019t vibrate. iPhone browsers don\u2019t allow web pages to vibrate.');
}

// "Messages after results" only matters while "Show encouraging messages" is on.
function renderEncouragementRow() {
  const on = loadPhoneSettings(localStorage).showEncouragement;
  document.querySelector('#encourageAfterResults').closest('.settingRow').classList.toggle('dependentOff', !on);
}

function render() {
  const settings = loadPhoneSettings(localStorage);
  const background = readBackground(localStorage);
  for (const input of bgGrid.querySelectorAll('input')) input.checked = input.value === background;
  for (const input of textSize.querySelectorAll('input')) input.checked = input.value === settings.textSize;
  organization.value = settings.organization;
  for (const key of SWITCHES) {
    const input = document.querySelector(`#${key}`);
    input.checked = input.disabled ? false : settings[key];
  }
  renderEncouragementRow();
}

document.querySelector('#resetSettings').addEventListener('click', () => {
  if (!confirm('Reset the background and all settings on this phone to their defaults?')) return;
  resetPhoneSettings(localStorage);
  saveBackground('default', localStorage);
  render();
  refreshEncouragement();
  saved('Defaults restored');
});

// Another tab or a back/forward restore: show what is actually saved.
window.addEventListener('storage', render);
window.addEventListener('pageshow', render);
render();
