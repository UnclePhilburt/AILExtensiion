// Shared time-zone helpers. IMPACT's times are Central time. The phone always
// uses this zone for IMPACT and ignores lead.impactTimeZone (the extension's
// Options dropdown still sends it, defaulting to Eastern). The phone shows times
// in the rep's own zone, so a Central phone shows them exactly as IMPACT does.

export const IMPACT_TIME_ZONE = 'America/Chicago';

export function validTimeZone(timeZone, fallback = IMPACT_TIME_ZONE) {
  if (!timeZone || typeof timeZone !== 'string') return fallback;
  try { new Intl.DateTimeFormat('en-US', { timeZone }); return timeZone; } catch (_error) { return fallback; }
}

export function localTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_error) { return 'UTC'; }
}

// Wall-clock fields (month 1-12) of an instant in a time zone.
export function zonedParts(date, timeZone) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
  }).formatToParts(date instanceof Date ? date : new Date(date))) parts[part.type] = Number(part.value);
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute };
}

function offsetAt(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60000) * 60000;
}

// Epoch ms of a wall-clock time (monthIndex 0-11) in a time zone, DST-aware.
// A time skipped by a spring-forward change resolves to an adjacent valid time.
export function wallClockToInstant(timeZone, year, monthIndex, day, hour = 0, minute = 0) {
  const wanted = Date.UTC(year, monthIndex, day, hour, minute);
  let instant = wanted - offsetAt(wanted, timeZone);
  instant = wanted - offsetAt(instant, timeZone);
  return instant;
}

// The instant when it is `hour`:00 in `timeZone` on that zone's calendar day of `date`.
export function zonedInstant(date, timeZone, hour) {
  const { year, month, day } = zonedParts(date, timeZone);
  return new Date(wallClockToInstant(timeZone, year, month - 1, day, hour));
}

// A whole-day number for the calendar day of `ms` in `timeZone`.
export function zonedDayNumber(ms, timeZone) {
  const { year, month, day } = zonedParts(ms, timeZone);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

// "Eastern", "Central", "Pacific" …
export function timeZoneName(timeZone, date = new Date()) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' })
      .formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || timeZone;
    return name.replace(/\s+(Daylight|Standard)\s+Time$/i, '').replace(/\s+Time$/i, '');
  } catch (_error) { return timeZone; }
}

// Compact label: "ET", "CT", "PT", "AKT"; other zones keep Intl's short name.
export function timeZoneAbbr(timeZone, date = new Date()) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || timeZone;
    return name.replace(/^([A-Z]{1,2})[SD]T$/, '$1T');
  } catch (_error) { return timeZone; }
}

// "9:38 PM"
export function clockTime(ms, timeZone) {
  return new Date(ms).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
}
