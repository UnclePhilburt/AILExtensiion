import { loadPhoneSettings } from './settings-store.js';

// Elements with data-with-name="{name}'s workspace" keep their original text
// until a first name is saved, then show that line with the name filled in.
export function applyUserName(root = document) {
  const name = loadPhoneSettings(localStorage).firstName;
  for (const element of root.querySelectorAll?.('[data-with-name]') || []) {
    if (!element.dataset.nameFallback) element.dataset.nameFallback = element.textContent;
    const template = element.getAttribute('data-with-name') || '';
    element.textContent = name ? template.split('{name}').join(name) : element.dataset.nameFallback;
  }
}
