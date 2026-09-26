// Calling hours follow the clock on this phone or computer: 9:00 AM through 9:00 PM.
// 9:00 PM is already closed.
import { zonedParts } from './time-zone.js';

export const CLOSED_MESSAGE = 'Companion is closed. You can sign in from 9:00 AM to 9:00 PM in your time zone.';

export function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_error) { return 'UTC'; }
}

export function callingHoursOpen(now = new Date(), timeZone = deviceTimeZone()) {
  const { hour } = zonedParts(now, timeZone);
  return hour >= 9 && hour < 21;
}
