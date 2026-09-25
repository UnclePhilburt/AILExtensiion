// Home page text: time-of-day greeting, the signed-in name (only when the
// account actually has one) and the "today" line on the Calendar shortcut.
// Pure functions; home.js does the DOM and the network.

import { IMPACT_TIME_ZONE } from './time-zone.js';
import { timeOfDay } from './encouragement.js';
import { dayKey, normalizeEvent } from './calendar-events.js';

const GREETINGS = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', lateNight: 'Welcome back' };

// First name from the account's profile data, or '' (never guessed from the email).
export function displayName(user) {
  const meta = user?.user_metadata || {};
  for (const value of [meta.first_name, meta.given_name, meta.full_name, meta.name, meta.display_name]) {
    if (typeof value !== 'string') continue;
    const first = value.trim().split(/\s+/)[0] || '';
    if (first && !first.includes('@') && first.length <= 30) return first;
  }
  return '';
}

export function greeting(now = Date.now(), name = '') {
  const hello = GREETINGS[timeOfDay(now)];
  return name ? `${hello}, ${name}` : hello;
}

// "Thursday, September 24" in Central time.
export function dateLine(now = Date.now()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: IMPACT_TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric' }).format(now);
}

// Calendar shortcut caption from scheduled_events rows; '' keeps the default caption.
export function todaySummary(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return '';
  const today = dayKey(now);
  const events = rows.map(normalizeEvent).filter((event) => event && event.day === today);
  if (!events.length) return 'Nothing scheduled today';
  const callbacks = events.filter((event) => event.kind === 'callback').length;
  const appointments = events.length - callbacks;
  const parts = [];
  if (appointments) parts.push(`${appointments} appointment${appointments === 1 ? '' : 's'}`);
  if (callbacks) parts.push(`${callbacks} callback${callbacks === 1 ? '' : 's'}`);
  return `${parts.join(' · ')} today`;
}
