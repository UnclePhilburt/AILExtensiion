// Calling hours are 9:00 AM through 9:00 PM Central time. 9:00 PM is already closed.
import { IMPACT_TIME_ZONE, zonedParts } from './time-zone.js';

export const CLOSED_MESSAGE = 'Companion is closed. You can sign in from 9:00 AM to 9:00 PM Central time.';

export function callingHoursOpen(now = new Date()) {
  const { hour } = zonedParts(now, IMPACT_TIME_ZONE);
  return hour >= 9 && hour < 21;
}
