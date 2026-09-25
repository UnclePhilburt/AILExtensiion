// Calendar logic (pure): turns a lead's IMPACT Status history into calendar
// events, and groups/lays out events for calendar.html. No storage, no DOM.
//
// Only the CURRENT scheduled appointment and the CURRENT callback of a lead
// count (IMPACT lists Status lines newest first, and a newer Schedule /
// Reschedule line replaces older ones), and only when they were set "by Me"
// (lines set by another agent are their meetings, not yours).
// Times are IMPACT's wall clock in Central time; a "No Time Preference" line is
// an all-day ("Any time") event stored at Central midnight.

import { IMPACT_TIME_ZONE, wallClockToInstant, zonedParts, clockTime } from './time-zone.js';
import { splitHistory, parseHistoryEntry } from './lead-highlights.js';

export const EVENT_KINDS = { appointment: 'Appointment', 'virtual-appointment': 'Virtual appointment', callback: 'Callback' };
export const UPCOMING_DAYS = 14;
const ZONE = IMPACT_TIME_ZONE;
const SLOT_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- From leads to events ----------

// Same identity the Workspace uses: the IMPACT lead id, else the lead's details.
export function leadKeyFor(lead) {
  if (lead?.leadId) return clip(`lead:${lead.leadId}`, 300);
  const key = [lead?.leadName || '', lead?.email || '', lead?.address || '', (lead?.phones || []).map((p) => p?.number || '').join('|')].join('::');
  return key.replace(/[:|]/g, '') ? clip(key, 300) : '';
}

// The lead details stored with each event.
export function leadSnapshot(lead) {
  const phones = Array.isArray(lead?.phones) ? lead.phones : [];
  const phone = phones.find((p) => /mobile/i.test(p?.label || '')) || phones[0];
  return {
    leadKey: leadKeyFor(lead),
    leadId: clip(lead?.leadId, 100),
    leadName: clip(lead?.leadName, 200),
    phone: clip(phone?.number, 40),
    address: clip(lead?.address, 300),
    requestType: clip(lead?.requestType, 200)
  };
}

const setByMe = (entry) => !entry.by || /^me$/i.test(entry.by.trim());
const eventKind = (entry) => entry.kind === 'callback' ? 'callback' : /virtual/i.test(`${entry.type} ${entry.action}`) ? 'virtual-appointment' : 'appointment';

// [{ kind, startsAt (ISO), allDay, source: 'history', sourceLine }] — at most one appointment and one callback.
export function scheduleFromHistory(callHistory) {
  const entries = splitHistory(callHistory).map((line) => parseHistoryEntry(line));
  const events = [];
  for (const group of ['appointment', 'callback']) {
    const current = entries.find((entry) => entry.kind === group && entry.scheduled);
    if (!current || !setByMe(current)) continue;
    const date = current.dates[0];
    events.push({ kind: eventKind(current), startsAt: new Date(date.at).toISOString(), allDay: !date.hasTime, source: 'history', sourceLine: clip(current.text, 500) });
  }
  return events;
}

// The IMPACT day tab label of Set Virtual Appointment (e.g. "Today", "Thu 9/24",
// "Sep 24") as { year, month (0-11), day } in Central, or null if the label has
// no clear date. A label without a year is taken as the next such date (up to
// 60 days back counts as this year).
export function parseSlotDay(label, now = Date.now()) {
  const text = String(label || '').trim();
  const today = zonedParts(now, ZONE);
  const fromUtc = (ms) => { const d = new Date(ms); return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() }; };
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  if (/^today\b/i.test(text)) return fromUtc(todayUtc);
  if (/^tomorrow\b/i.test(text)) return fromUtc(todayUtc + 86400000);
  let month, day, year;
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/);
  const named = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
  if (numeric) { month = Number(numeric[1]) - 1; day = Number(numeric[2]); year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null; }
  else if (named) { month = SLOT_MONTHS[named[1].toLowerCase()]; day = Number(named[2]); year = named[3] ? Number(named[3]) : null; }
  else return null;
  if (year === null) {
    year = today.year;
    if (Date.UTC(year, month, day) < todayUtc - 60 * 86400000) year += 1;
  }
  const check = new Date(Date.UTC(year, month, day));
  if (check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

// The event for an appointment chosen on the phone (day tab label + slot label), or null if unclear.
export function appointmentChoiceEvent(dayLabel, time, now = Date.now()) {
  const day = parseSlotDay(dayLabel, now);
  const slot = String(time || '').trim();
  if (!day || !slot) return null;
  let allDay = false, hour = 0, minute = 0;
  if (/^(right now|no time preference)$/i.test(slot)) allDay = true;
  else {
    const match = slot.match(/^(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?$/i);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 12 || Number(match[2]) > 59) return null;
    hour = Number(match[1]) % 12 + (/p/i.test(match[3]) ? 12 : 0);
    minute = Number(match[2]);
  }
  const at = wallClockToInstant(ZONE, day.year, day.month, day.day, hour, minute);
  return { kind: 'virtual-appointment', startsAt: new Date(at).toISOString(), allDay, source: 'phone', sourceLine: clip(`Set from the phone: ${dayLabel} · ${slot}`, 500) };
}

// ---------- Calendar layout ----------

// "2026-09-24": the Central calendar day of an instant.
export function dayKey(at) {
  const p = zonedParts(at, ZONE);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
const keyOf = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;
const utcOfKey = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export function addDays(key, days) { const d = new Date(utcOfKey(key) + days * 86400000); return keyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }

// A stored row (scheduled_events) as a display event; null when unusable.
export function normalizeEvent(row) {
  const at = Date.parse(row?.starts_at);
  if (!Number.isFinite(at) || !EVENT_KINDS[row?.kind]) return null;
  return {
    id: row.id, kind: row.kind, at, allDay: Boolean(row.all_day), day: dayKey(at),
    leadName: row.lead_name || 'Lead', phone: row.phone || '', address: row.address || '',
    requestType: row.request_type || '', sourceLine: row.source_line || ''
  };
}

// Any-time events first, then by time, then by name.
export function sortEvents(events) {
  return [...events].sort((a, b) => a.day.localeCompare(b.day) || (b.allDay - a.allDay) || (a.at - b.at) || a.leadName.localeCompare(b.leadName));
}

export function groupByDay(events) {
  const groups = new Map();
  for (const event of sortEvents(events)) {
    if (!groups.has(event.day)) groups.set(event.day, []);
    groups.get(event.day).push(event);
  }
  return groups;
}

// 6 weeks x 7 days (Sunday first) covering the month: { key, day, inMonth, isToday }.
export function monthGrid(year, month, todayKey = '') {
  const first = Date.UTC(year, month, 1);
  const start = first - new Date(first).getUTCDay() * 86400000;
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start + (w * 7 + d) * 86400000);
      const key = keyOf(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      week.push({ key, day: date.getUTCDate(), inMonth: date.getUTCMonth() === month, isToday: key === todayKey });
    }
    weeks.push(week);
  }
  return weeks;
}

export function shiftMonth(year, month, delta) {
  const d = new Date(Date.UTC(year, month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

export function monthLabel(year, month) { return `${MONTH_NAMES[month]} ${year}`; }

export function dayHeading(key, todayKey = '') {
  const label = new Date(utcOfKey(key)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
  if (key === todayKey) return `Today · ${label}`;
  if (todayKey && key === addDays(todayKey, 1)) return `Tomorrow · ${label}`;
  return label;
}

// 'past' | 'today' | 'upcoming'. Any-time events are due for their whole Central day.
export function eventStatus(event, now) {
  const today = dayKey(now);
  if (event.day < today) return 'past';
  if (!event.allDay && event.at < now) return 'past';
  return event.day === today ? 'today' : 'upcoming';
}

// Not yet past, from now through the end of the 14th day after today.
export function upcomingEvents(events, now, days = UPCOMING_DAYS) {
  const last = addDays(dayKey(now), days);
  return sortEvents(events.filter((event) => event.day <= last && eventStatus(event, now) !== 'past'));
}

// "3:00 PM" in Central, or "Any time".
export function formatEventTime(event) { return event.allDay ? 'Any time' : clockTime(event.at, ZONE); }

// "2:00 PM your time" when the phone's clock differs from Central, else "".
export function phoneTimeNote(event, phoneZone) {
  if (event.allDay || !phoneZone) return '';
  try {
    const local = clockTime(event.at, phoneZone);
    return local === clockTime(event.at, ZONE) ? '' : `${local} your time`;
  } catch (_error) { return ''; }
}

export function telHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 7 ? `tel:${digits}` : '';
}
