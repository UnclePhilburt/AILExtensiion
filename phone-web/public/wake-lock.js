// Keeps the screen on while the Workspace page is visible, if "Keep screen awake"
// is on (Settings) and the browser supports the Screen Wake Lock API. The browser
// drops the lock whenever the page is hidden, so it is taken again on return.
import { loadPhoneSettings, SETTINGS_KEY } from './settings-store.js';

const supported = Boolean(globalThis.navigator?.wakeLock?.request);
let sentinel = null;
let requesting = false;

async function acquire() {
  if (!supported || requesting || document.hidden || (sentinel && !sentinel.released)) return;
  if (!loadPhoneSettings(localStorage).keepAwake) return;
  requesting = true;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch (_error) {
    // Denied (battery saver, not allowed yet): try again on the next tap or return.
    sentinel = null;
  } finally {
    requesting = false;
  }
}

function sync() {
  if (!supported) return;
  if (loadPhoneSettings(localStorage).keepAwake) void acquire();
  else if (sentinel) { void sentinel.release().catch(() => {}); sentinel = null; }
}

if (supported) {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('pageshow', sync);
  window.addEventListener('storage', (event) => { if (event.key === null || event.key === SETTINGS_KEY) sync(); });
  // Some browsers only grant the lock after a user gesture.
  document.addEventListener('pointerdown', () => { if (!sentinel) sync(); }, { passive: true });
  sync();
}
