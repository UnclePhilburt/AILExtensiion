// The phone Settings sheet (opened by any [data-open-settings] button).
// Currently holds the Background picker; choices are saved on this phone.
import { BACKGROUNDS, BACKGROUND_STORAGE_KEY, readBackground, saveBackground, applyBackground } from './backgrounds.js';

const root = document.documentElement;
applyBackground(readBackground(localStorage), root);

let sheet = null;

function buildSheet() {
  const dialog = document.createElement('dialog');
  dialog.className = 'settingsSheet';
  dialog.setAttribute('aria-labelledby', 'settingsTitle');
  dialog.innerHTML = `<form method="dialog" class="settingsInner">
<div class="settingsHead"><div><p class="eyebrow">IMPACT COMPANION</p><h2 id="settingsTitle">Settings</h2></div><button class="settingsClose" value="close" aria-label="Close settings">×</button></div>
<fieldset class="bgPicker"><legend>Background</legend><p class="settingsHint">Saved on this phone. Applies to Home, Workspace and Statistics.</p><div class="bgGrid"></div></fieldset>
<button class="settingsDone" value="done">Done</button>
</form>`;
  const grid = dialog.querySelector('.bgGrid');
  const current = readBackground(localStorage);
  for (const option of BACKGROUNDS) {
    const label = document.createElement('label');
    label.className = 'bgOption';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'background';
    input.value = option.id;
    input.checked = option.id === current;
    const swatch = document.createElement('span');
    swatch.className = 'bgSwatch';
    swatch.dataset.bgSwatch = option.id;
    swatch.setAttribute('aria-hidden', 'true');
    swatch.innerHTML = '<i></i><i></i>';
    const name = document.createElement('span');
    name.className = 'bgName';
    name.textContent = option.label;
    label.append(input, swatch, name);
    grid.append(label);
  }
  grid.addEventListener('change', (event) => {
    if (event.target.name !== 'background') return;
    applyBackground(saveBackground(event.target.value, localStorage), root);
  });
  // Tapping the dimmed area outside the sheet closes it.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  document.body.append(dialog);
  return dialog;
}

export function openSettings() {
  sheet ||= buildSheet();
  const selected = readBackground(localStorage);
  for (const input of sheet.querySelectorAll('input[name="background"]')) input.checked = input.value === selected;
  if (typeof sheet.showModal === 'function') sheet.showModal(); else sheet.setAttribute('open', '');
  sheet.querySelector('input:checked')?.focus();
}

for (const button of document.querySelectorAll('[data-open-settings]')) button.addEventListener('click', openSettings);

// Another tab changed the background: follow it.
window.addEventListener('storage', (event) => {
  if (event.key === null || event.key === BACKGROUND_STORAGE_KEY) applyBackground(readBackground(localStorage), root);
});
