// Phone background choices. The colors live in styles.css as
// html[data-bg="<id>"] rules (plus [data-bg-swatch="<id>"] for the picker
// previews); this module only holds the list and the pure save/apply logic.
// settings-boot.js applies the saved choice before first paint, so keep
// BACKGROUND_STORAGE_KEY in sync with it. The picker is on settings.html.

export const BACKGROUND_STORAGE_KEY = 'impact.phoneBackground';
export const DEFAULT_BACKGROUND = 'default';

export const BACKGROUNDS = [
  { id: 'default', label: 'Default', kind: 'default' },
  { id: 'evergreen', label: 'Evergreen', kind: 'solid' },
  { id: 'midnight', label: 'Midnight', kind: 'solid' },
  { id: 'slate', label: 'Slate', kind: 'solid' },
  { id: 'forest', label: 'Forest', kind: 'solid' },
  { id: 'navy', label: 'Navy', kind: 'solid' },
  { id: 'plum', label: 'Plum', kind: 'solid' },
  { id: 'aurora', label: 'Aurora', kind: 'gradient' },
  { id: 'ocean', label: 'Ocean', kind: 'gradient' },
  { id: 'dusk', label: 'Dusk', kind: 'gradient' },
  { id: 'sunset', label: 'Sunset', kind: 'gradient' }
];

// A known background id, or the default for anything else (missing, removed, junk).
export function normalizeBackground(id) {
  return BACKGROUNDS.some((option) => option.id === id) ? id : DEFAULT_BACKGROUND;
}

export function readBackground(storage) {
  try { return normalizeBackground(storage?.getItem(BACKGROUND_STORAGE_KEY)); } catch (_error) { return DEFAULT_BACKGROUND; }
}

// Saves the choice; the default is stored as "no choice" so it follows future defaults.
export function saveBackground(id, storage) {
  const value = normalizeBackground(id);
  try {
    if (value === DEFAULT_BACKGROUND) storage?.removeItem(BACKGROUND_STORAGE_KEY);
    else storage?.setItem(BACKGROUND_STORAGE_KEY, value);
  } catch (_error) {
    // Private mode or full storage: the choice still applies for this page.
  }
  return value;
}

// Sets data-bg on <html> (removed for the default, which is the plain stylesheet).
export function applyBackground(id, root) {
  const value = normalizeBackground(id);
  if (value === DEFAULT_BACKGROUND) root?.removeAttribute('data-bg');
  else root?.setAttribute('data-bg', value);
  return value;
}
