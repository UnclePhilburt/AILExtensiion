// Builds the phone's "Heads-up" chips from the lead's IMPACT Status history.
//
// Real IMPACT Status lines (newest first, as IMPACT lists them):
//   No Answer on Sep 23 2026 09:38 PM by Me
//   Schedule Call Back appointment on Sep 24 2026 - No Time Preference by Me
//   Checkin on Sep 22 2026 04:41 PM by Me
//   Schedule Virtual Appointment on Sep 22 2026 03:00 PM by Me
//   Reschedule appointment on Sep 22 2026 06:30 PM by Me.
//   SetVirtualAppt by Me
// For "Schedule ..." / "Reschedule ..." lines the date is the time that was
// SCHEDULED, not when the line was logged (a Sep 22 3:00 PM appointment is
// listed below a 2:56 PM No Answer; a Sep 24 callback sits between Sep 22 and
// Sep 23 lines).
//
// Times are IMPACT's wall clock in Central time (IMPACT_TIME_ZONE; the lead's
// impactTimeZone field is ignored). They are converted to real instants, compared with the
// real "now", and shown in the phone's own time zone. A date with no time
// (a "No Time Preference" callback) is an IMPACT calendar day, so "today" for
// those follows IMPACT's calendar.

import { IMPACT_TIME_ZONE, validTimeZone, localTimeZone, wallClockToInstant, zonedParts, zonedDayNumber, timeZoneAbbr, clockTime } from './time-zone.js';

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const DAY = 24 * 60 * 60 * 1000;
const DATE_PATTERN = new RegExp(
  '\\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})' +
  '|(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4}))' +
  '(?:,?\\s+(?:at\\s+|-\\s+)?(\\d{1,2}):(\\d{2})(?::\\d{2})?\\s*([ap])\\.?m\\.?)?', 'gi');
// Words a Status line starts with, used to split lines IMPACT's text ran together.
const ACTION_START = /(?:No Answer|Schedule|Reschedule|Checkin|Check-?in|SetVirtualAppt|Set [A-Z]|Refused|Call ?Back|Left |Voice ?mail|Bad |Wrong |Do Not|Not Interested|Appointment|Cancel|Comment)/;
const SPLIT = new RegExp(`(?<=\\bby [A-Z][a-z]*\\.?)\\s*(?=${ACTION_START.source})`);

// { impact, phone } time zones used for parsing and display. IMPACT is always
// Central; any impactTimeZone passed in is ignored.
export function resolveZones({ phoneTimeZone } = {}) {
  return { impact: IMPACT_TIME_ZONE, phone: validTimeZone(phoneTimeZone || localTimeZone(), 'UTC') };
}

export function findDates(text) {
  const zone = IMPACT_TIME_ZONE;
  const found = [];
  for (const match of String(text || '').matchAll(DATE_PATTERN)) {
    const month = match[1] ? MONTHS[match[1].toLowerCase()] : Number(match[4]) - 1;
    const day = Number(match[2] || match[5]);
    const year = Number(match[3] || match[6]);
    const hasTime = Boolean(match[7]);
    const hour = hasTime ? Number(match[7]) % 12 + (/p/i.test(match[9]) ? 12 : 0) : 0;
    const minute = hasTime ? Number(match[8]) : 0;
    const check = new Date(Date.UTC(year, month, day));
    if (check.getUTCMonth() !== month || check.getUTCDate() !== day || hour > 23 || minute > 59) continue;
    const at = wallClockToInstant(zone, year, month, day, hour, minute);
    if (!Number.isFinite(at)) continue;
    found.push({ at, hasTime, index: match.index, length: match[0].length });
  }
  return found;
}

export function classifyEntry(text) {
  const value = String(text || '');
  if (/\b(do not call|dnc|bad (phone|number)|wrong number|disconnected|invalid number)\b/i.test(value)) return 'bad-number';
  if (/\b(not interested|refused|declined)\b/i.test(value)) return 'refused';
  if (/\b(cancel(l?ed)?|no[- ]?show|missed)\b/i.test(value) && /\b(appointment|appt)\b/i.test(value)) return 'appointment-missed';
  if (/\bcall[- ]?back\b/i.test(value)) return 'callback';
  if (/^\s*(re)?schedule\b/i.test(value) || /\b(appointment|appt)\b/i.test(value)) return 'appointment';
  if (/\bcheck[- ]?in\b/i.test(value)) return 'checkin';
  if (/\b(no answer|voice ?mail|left (a )?message|busy)\b/i.test(value)) return 'attempt';
  return 'other';
}

function sentenceCase(value) {
  return /\d/.test(value) ? value : value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function parseHistoryEntry(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  const dates = findDates(value);
  const first = dates[0];
  const byMatch = value.match(/\s+by\s+([^.]{1,100}?)\.?\s*$/i);
  const body = byMatch ? value.slice(0, byMatch.index) : value.replace(/\.$/, '');
  let action = first ? body.slice(0, first.index).replace(/\s+(on|for|at)\s*$/i, '') : body;
  action = action.trim().replace(/[.:,-]$/, '').trim() || value;
  // Whatever follows the date, e.g. "- No Time Preference".
  const after = first ? body.slice(first.index + first.length).replace(/^\s*[-–:,]\s*/, '').trim() : '';
  const kind = classifyEntry(value);
  const scheduled = Boolean(first) && (kind === 'callback' || (kind === 'appointment' && /^(re)?schedule\b/i.test(action)) || (kind === 'appointment' && /\bappointment\b/i.test(action)));
  const type = kind === 'appointment' ? (action.match(/^(?:re)?schedule\s+(.*?)\s*appointment\b/i)?.[1] || '').trim() : '';
  return {
    text: value, action, by: byMatch?.[1] || '', dates, kind, scheduled,
    reschedule: /^reschedule\b/i.test(action), type,
    preference: after ? sentenceCase(after) : ''
  };
}

// IMPACT sometimes runs Status lines together; split them back apart.
export function splitHistory(callHistory) {
  if (!Array.isArray(callHistory)) return [];
  return callHistory.flatMap((entry) => String(entry || '').split(SPLIT)).map((entry) => entry.trim()).filter(Boolean);
}

// Calendar-day difference. Timed entries follow the phone's calendar (they are
// shown in phone time); date-only entries follow IMPACT's calendar.
function dayDiff(at, now, hasTime = true, zones = resolveZones()) {
  const zone = hasTime ? zones.phone : zones.impact;
  return zonedDayNumber(at, zone) - zonedDayNumber(now, zone);
}

function sameClock(at, zones) { return clockTime(at, zones.phone) === clockTime(at, zones.impact); }

// "(3:00 PM ET)" when IMPACT's clock differs from the phone's, else "".
function impactClockNote(at, zones) {
  return sameClock(at, zones) ? '' : ` (${clockTime(at, zones.impact)} ${timeZoneAbbr(zones.impact, new Date(at))})`;
}

// Timed dates in phone time; date-only dates as IMPACT's calendar day.
export function formatWhen(at, hasTime, { weekday = true, zones = resolveZones(), impactClock = false } = {}) {
  const date = new Date(at).toLocaleDateString('en-US', {
    timeZone: hasTime ? zones.phone : zones.impact,
    ...(weekday ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' })
  });
  if (!hasTime) return date;
  return `${date}, ${clockTime(at, zones.phone)}${impactClock ? impactClockNote(at, zones) : ''}`;
}

export function relativeTime(at, now, hasTime = true, zones = resolveZones()) {
  const days = dayDiff(at, now, hasTime, zones);
  const diff = at - now;
  if (days === 0) {
    if (!hasTime) return 'today';
    const minutes = Math.round(Math.abs(diff) / 60000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return diff > 0 ? `in ${minutes} min` : `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return diff > 0 ? `in ${hours} hr${hours === 1 ? '' : 's'}` : `${hours} hr${hours === 1 ? '' : 's'} ago`;
  }
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1) return `in ${days} days`;
  return `${-days} days ago`;
}

// For Previous activity and comments, which show IMPACT's own text: the first
// IMPACT time in the line converted to phone time, e.g. "8:38 PM your time".
// Empty when the line has no time or both clocks agree.
export function localTimeNote(text, options = {}) {
  const zones = options.zones || resolveZones(options);
  const date = findDates(text).find((found) => found.hasTime);
  if (!date || sameClock(date.at, zones)) return '';
  const impactDay = zonedParts(date.at, zones.impact), phoneDay = zonedParts(date.at, zones.phone);
  const differentDay = impactDay.day !== phoneDay.day || impactDay.month !== phoneDay.month;
  const day = differentDay ? `${new Date(date.at).toLocaleDateString('en-US', { timeZone: zones.phone, month: 'short', day: 'numeric' })}, ` : '';
  return `${day}${clockTime(date.at, zones.phone)} your time`;
}

// When a scheduled time stands relative to now. A date with no time counts as
// due for that whole day.
export function scheduleStatus(date, now, zones = resolveZones()) {
  const days = dayDiff(date.at, now, date.hasTime, zones);
  if (!date.hasTime) return days > 0 ? 'upcoming' : days === 0 ? 'today' : 'past';
  if (date.at < now) return 'past';
  return days === 0 ? 'today' : 'upcoming';
}

// "Today · No time preference", "Tue, Sep 22, 2:00 PM (3:00 PM ET)"
function scheduledTitle(entry, date, now, zones) {
  const days = dayDiff(date.at, now, date.hasTime, zones);
  const when = days === 0
    ? (date.hasTime ? `Today, ${clockTime(date.at, zones.phone)}${impactClockNote(date.at, zones)}` : 'Today')
    : formatWhen(date.at, date.hasTime, { zones, impactClock: true });
  return entry.preference ? `${when} · ${entry.preference}` : when;
}

function appointmentName(entry) {
  return entry.type ? `${sentenceCase(entry.type)} appointment` : 'Appointment';
}

// Returns chips, most important first: { tone, label, title, detail, soon, muted }
// tone: 'appointment' | 'callback' | 'danger' | 'neutral'
// Times in titles/details are phone time; scheduled times also show IMPACT's
// clock when it differs, e.g. "Tue, Sep 22, 2:00 PM (3:00 PM ET)".
export function buildHeadsUp(callHistory, now, { max = 4, phoneTimeZone } = {}) {
  const zones = resolveZones({ phoneTimeZone });
  const entries = splitHistory(callHistory).map((entry) => parseHistoryEntry(entry));
  const days = (date) => dayDiff(date.at, now, date.hasTime, zones);
  const rel = (date) => relativeTime(date.at, now, date.hasTime, zones);
  const when = (date, options = {}) => formatWhen(date.at, date.hasTime, { zones, ...options });
  if (!entries.length) return [];
  const active = [], context = [];
  const happened = (entry) => entry.dates[0] && entry.dates[0].at <= now;
  const newest = (list) => [...list].sort((a, b) => b.dates[0].at - a.dates[0].at)[0];

  // The first scheduled line in IMPACT's newest-first list is the current one:
  // a newer Schedule/Reschedule replaces older ones.
  const appointment = entries.find((e) => e.kind === 'appointment' && e.scheduled);
  if (appointment) {
    const date = appointment.dates[0];
    const status = scheduleStatus(date, now, zones);
    const dayCount = days(date);
    const name = appointmentName(appointment) + (appointment.reschedule ? ' (rescheduled)' : '');
    if (status !== 'past') {
      active.push({ tone: 'appointment', label: status === 'today' ? 'Appointment today' : 'Upcoming appointment',
        title: scheduledTitle(appointment, date, now, zones), detail: `${name} · ${rel(date)}`,
        soon: dayCount <= 1, at: date.at });
    } else if (dayCount >= -30) {
      context.push({ tone: 'neutral', label: 'Had appointment', title: when(date, { impactClock: true }),
        detail: `${name} · ${rel(date)}`, muted: true, order: 2 });
    }
  }

  const callback = entries.find((e) => e.kind === 'callback' && e.scheduled);
  if (callback) {
    const date = callback.dates[0];
    const status = scheduleStatus(date, now, zones);
    const dayCount = days(date);
    if (status !== 'past') {
      active.push({ tone: 'callback', label: status === 'today' ? 'Callback due today' : 'Callback set',
        title: scheduledTitle(callback, date, now, zones),
        detail: status === 'today' && !date.hasTime ? 'Call back any time today' : rel(date),
        soon: dayCount <= 1, at: date.at });
    } else if (dayCount >= -14) {
      context.push({ tone: 'callback', label: 'Callback date passed', title: scheduledTitle(callback, date, now, zones),
        detail: rel(date), muted: true, order: 1 });
    }
  }
  active.sort((a, b) => a.at - b.at);

  const warning = entries.find((e) => ['bad-number', 'refused', 'appointment-missed'].includes(e.kind) && (!e.dates[0] || happened(e) || e.kind === 'appointment-missed'));
  if (warning) {
    const label = warning.kind === 'bad-number' ? 'Check the number' : warning.kind === 'refused' ? 'Refused before' : 'Missed / cancelled appointment';
    const date = warning.dates[0];
    context.push({ tone: 'danger', label, title: warning.action, detail: date ? `${when(date)} · ${rel(date)}` : '', order: 0 });
  }

  // Tries that already happened (a line dated after "now" can't be a real try).
  const attempts = entries.filter((e) => e.kind === 'attempt' && (!e.dates[0] || happened(e)));
  if (attempts.length) {
    const noAnswers = attempts.filter((e) => /no answer/i.test(e.text)).length;
    const dated = attempts.filter((e) => e.dates[0]);
    const last = dated.length ? newest(dated).dates[0] : null;
    const today = dated.filter((e) => days(e.dates[0]) === 0).length;
    const title = noAnswers === attempts.length
      ? `${noAnswers} no answer${noAnswers === 1 ? '' : 's'}`
      : `${attempts.length} tries${noAnswers ? ` (${noAnswers} no answer${noAnswers === 1 ? '' : 's'})` : ''}`;
    const detail = [last ? `Last ${when(last, { weekday: false })} · ${rel(last)}` : '',
      today ? `${today} today` : ''].filter(Boolean).join(' · ');
    context.push({ tone: 'neutral', label: 'Previous tries', title, detail, order: 3 });
  }

  const checkins = entries.filter((e) => e.kind === 'checkin' && happened(e) && now - e.dates[0].at <= 14 * DAY);
  if (checkins.length) {
    const checkin = newest(checkins);
    const date = checkin.dates[0];
    context.push({ tone: 'neutral', label: 'Recent activity', title: checkin.action,
      detail: `${when(date)} · ${rel(date)}`, muted: true, order: 4 });
  }

  context.sort((a, b) => a.order - b.order);
  return [...active, ...context].slice(0, max).map(({ at, order, ...chip }) => chip);
}
