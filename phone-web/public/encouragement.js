// Encouragement lines: pure selection logic (no DOM). encouragement-ui.js puts
// the chosen line on the page. Lines live in encouragement-lines.js.
//
// A line is picked at random, weighted by context: the page, the time of day in
// Central time, whether the Workspace is waiting for a lead, and the result that
// was just sent. The IDs of the last SEEN_LIMIT lines shown are kept in
// localStorage so nothing repeats until a large share of the pool has been seen.

import { ENCOURAGEMENT_LINES } from './encouragement-lines.js';
import { IMPACT_TIME_ZONE, zonedParts } from './time-zone.js';

export const SEEN_KEY = 'impact.encouragementSeen';
export const SEEN_LIMIT = 200;
export const CATEGORIES = Object.freeze(Object.keys(ENCOURAGEMENT_LINES));

// Stable short ID from the text (FNV-1a), so edits to one line don't reshuffle
// the IDs of the others.
export function lineId(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

const LINES_BY_CATEGORY = {};
for (const category of CATEGORIES) {
  LINES_BY_CATEGORY[category] = ENCOURAGEMENT_LINES[category].map((text) => ({ id: lineId(text), text, category }));
}

export function linesIn(category) {
  return LINES_BY_CATEGORY[category] || [];
}

export function allLines() {
  return CATEGORIES.flatMap(linesIn);
}

// Morning 5:00-11:59, afternoon 12:00-4:59 PM, evening 5:00-9:59 PM, late night
// 10 PM-4:59 AM, in Central time (the team's time zone).
export function timeOfDay(now = Date.now(), timeZone = IMPACT_TIME_ZONE) {
  const { hour } = zonedParts(now, timeZone);
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'lateNight';
}

// Result types sent from the Workspace -> the category of the follow-up message.
const EVENT_CATEGORIES = Object.freeze({
  'no-answer': 'noAnswer',
  'refused-appointment': 'refused',
  'virtual-appointment-slot': 'appointment'
});

export function eventCategory(type) {
  return EVENT_CATEGORIES[type] || null;
}

// Relative weights of each category for a context.
export function contextWeights({ page = 'home', event = null, waiting = false, now = Date.now() } = {}) {
  const time = timeOfDay(now);
  const fromEvent = eventCategory(event) || (CATEGORIES.includes(event) ? event : null);
  const weights = {};
  const add = (category, weight) => { weights[category] = (weights[category] || 0) + weight; };
  if (fromEvent) {
    add(fromEvent, 8); add('breathing', 1); add('general', 1);
  } else if (page === 'workspace' && waiting) {
    add('waiting', 6); add('breathing', 2); add(time, 1); add('general', 1);
  } else if (page === 'workspace') {
    add('general', 5); add(time, 3); add('breathing', 2);
  } else if (page === 'home') {
    add('general', 4); add(time, 4); add('breathing', 2);
  } else if (page === 'calendar') {
    add('calendar', 6); add('general', 2); add(time, 1); add('breathing', 1);
  } else if (page === 'statistics') {
    add('statistics', 6); add('general', 3); add('breathing', 1);
  } else if (page === 'settings') {
    add('settings', 6); add('breathing', 2); add('general', 2);
  } else {
    add('general', 6); add(time, 2); add('breathing', 2);
  }
  return weights;
}

function weightedCategory(weights, random) {
  const entries = Object.entries(weights).filter(([category, weight]) => weight > 0 && linesIn(category).length);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [category, weight] of entries) {
    roll -= weight;
    if (roll < 0) return category;
  }
  return entries[entries.length - 1][0];
}

// Picks one line. `seen` is the recent-history list (oldest first). Categories
// whose lines were all seen recently step aside for the others in the context;
// only when every weighted category is used up does the line seen longest ago
// come back.
export function pickLine({ seen = [], random = Math.random, ...context } = {}) {
  const recent = new Set(seen);
  const weights = contextWeights(context);
  const withFresh = Object.fromEntries(Object.entries(weights)
    .filter(([category]) => linesIn(category).some((line) => !recent.has(line.id))));
  const category = weightedCategory(Object.keys(withFresh).length ? withFresh : weights, random);
  const lines = linesIn(category);
  const fresh = lines.filter((line) => !recent.has(line.id));
  if (fresh.length) return fresh[Math.min(fresh.length - 1, Math.floor(random() * fresh.length))];
  const lastSeen = new Map(seen.map((id, index) => [id, index]));
  return lines.reduce((oldest, line) => (lastSeen.get(line.id) < lastSeen.get(oldest.id) ? line : oldest));
}

export function loadSeen(storage) {
  try {
    const value = JSON.parse(storage?.getItem(SEEN_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string').slice(-SEEN_LIMIT) : [];
  } catch (_error) {
    return [];
  }
}

// Adds an ID to the history ring (moving it to the newest end) and saves it.
export function rememberSeen(storage, id, limit = SEEN_LIMIT) {
  const seen = loadSeen(storage).filter((item) => item !== id);
  seen.push(id);
  const trimmed = seen.slice(-limit);
  try { storage?.setItem(SEEN_KEY, JSON.stringify(trimmed)); } catch (_error) { /* storage full or blocked */ }
  return trimmed;
}

// Pick + remember in one step.
export function nextLine(storage, context = {}) {
  const line = pickLine({ ...context, seen: loadSeen(storage) });
  rememberSeen(storage, line.id);
  return line;
}
