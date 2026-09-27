import { loadPhoneSettings, ORGANIZATIONS } from './settings-store.js';
import { applyUserName } from './user-name.js';

function render() {
  const organization = loadPhoneSettings(localStorage).organization;
  const label = ORGANIZATIONS.find((item) => item.id === organization);
  for (const element of document.querySelectorAll('[data-organization-label]')) {
    element.hidden = !label || organization === 'hidden';
    element.textContent = label?.label || '';
  }
  applyUserName();
}

window.addEventListener('storage', (event) => {
  if (event.key === 'impact.phoneSettings') render();
});
window.addEventListener('pageshow', render);
render();
