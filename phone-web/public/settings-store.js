// Phone settings (Settings page). Pure logic only: defaults, validation, load,
// save and reset, all against a Storage-like object (localStorage on the phone).
// The background has its own key (see backgrounds.js). settings-boot.js applies
// the display settings before first paint; keep it in sync with this file.

export const SETTINGS_KEY = 'impact.phoneSettings';
export const TEXT_SIZES = [
  { id: 'normal', label: 'Normal' },
  { id: 'large', label: 'Large' },
  { id: 'xlarge', label: 'Extra large' }
];
export const ORGANIZATIONS = [
  { id: 'shaefinator', label: 'Shaefinator Org' },
  { id: 'shaefer', label: 'Shaefer Org' },
  { id: 'hidden', label: 'Hide organization label' }
];

export const DEFAULT_SETTINGS = Object.freeze({
  keepAwake: true, // Screen Wake Lock on the Workspace page (where supported)
  vibrate: true, // short buzz when a result / Previous / Next tap is sent
  confirmResults: true, // ask before sending Refused Appointment
  textSize: 'normal', // Workspace text size
  showHeadsUp: true, // heads-up notes on the lead card
  showDoNotKnock: true, // the DO NOT KNOCK flag on the lead card
  autoSkipQuietHours: false, // move past an evening do-not-knock lead automatically
  showEncouragement: true, // calm rotating lines on each page (encouragement-ui.js)
  encourageAfterResults: true, // a short gentle message after a result is sent
  organization: 'shaefinator' // small organization label at the top of Home and Workspace
});

const BOOLEAN_KEYS = ['keepAwake', 'vibrate', 'confirmResults', 'showHeadsUp', 'showDoNotKnock', 'autoSkipQuietHours', 'showEncouragement', 'encourageAfterResults'];

// Known keys with valid values; anything missing or invalid keeps its value from
// `base` (the defaults unless given).
export function normalizeSettings(value, base = DEFAULT_SETTINGS) {
  const source = value && typeof value === 'object' ? value : {};
  const settings = { ...DEFAULT_SETTINGS, ...base };
  for (const key of BOOLEAN_KEYS) if (typeof source[key] === 'boolean') settings[key] = source[key];
  if (TEXT_SIZES.some((size) => size.id === source.textSize)) settings.textSize = source.textSize;
  if (ORGANIZATIONS.some((organization) => organization.id === source.organization)) settings.organization = source.organization;
  return settings;
}

export function loadPhoneSettings(storage) {
  try { return normalizeSettings(JSON.parse(storage?.getItem(SETTINGS_KEY) || 'null')); } catch (_error) { return { ...DEFAULT_SETTINGS }; }
}

// Merges a change into the saved settings (invalid values are ignored) and
// returns the full, valid result.
export function savePhoneSettings(storage, changes) {
  const settings = normalizeSettings(changes, loadPhoneSettings(storage));
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_error) { /* private mode or full: applies for this page only */ }
  return settings;
}

export function resetPhoneSettings(storage) {
  try { storage?.removeItem(SETTINGS_KEY); } catch (_error) { /* nothing saved to clear */ }
  return { ...DEFAULT_SETTINGS };
}

// The <html> data attributes that carry the display settings (null = remove).
export function displayAttributes(settings) {
  const s = normalizeSettings(settings);
  return {
    'data-text-size': s.textSize === 'normal' ? null : s.textSize,
    'data-hide-heads-up': s.showHeadsUp ? null : '',
    'data-hide-dnk': s.showDoNotKnock ? null : ''
  };
}
