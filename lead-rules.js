// Time-sensitive instructions that need to stand out before a rep calls.
//
// Union / Association leads must not be knocked in the evening. On the phone
// the flag starts at 7 PM Central (IMPACT's time zone, IMPACT_TIME_ZONE) and
// lasts until 6 AM. lead.impactTimeZone from the extension is ignored.
// lead.quietHoursNoticeAt (set when IMPACT itself shows its do-not-knock
// notice) can also turn the flag on for that evening.

import { IMPACT_TIME_ZONE, validTimeZone, localTimeZone, zonedParts, zonedInstant } from './time-zone.js';

export const QUIET_START_HOUR = 19; // 7 PM Central
export const QUIET_END_HOUR = 6;    // until 6 AM the next morning
const NOTICE_EARLIEST_HOUR = 17;    // IMPACT's notice counts from 5 PM Central
const NOTICE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function isQuietHours(now, timeZone = IMPACT_TIME_ZONE) {
  const { hour } = zonedParts(now, timeZone);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

// IMPACT showing its own notice is proof the quiet hours have started. It
// counts for that evening only: at most 12 hours, and never into the daytime.
export function quietHoursNoticeActive(noticeAt, now, timeZone = IMPACT_TIME_ZONE) {
  const at = Date.parse(noticeAt || '');
  if (!Number.isFinite(at) || at > now.getTime() + 60000 || now.getTime() - at > NOTICE_MAX_AGE_MS) return false;
  const { hour } = zonedParts(now, timeZone);
  return !(hour >= QUIET_END_HOUR && hour < NOTICE_EARLIEST_HOUR);
}

function shortTime(date, timeZone) {
  return date.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}

export function doNotKnockWarning(lead, now = new Date(), { phoneTimeZone = localTimeZone() } = {}) {
  const requestType = String(lead?.requestType || '');
  if (!/\b(union|association)\b/i.test(requestType)) return null;
  const byClock = isQuietHours(now);
  const byNotice = quietHoursNoticeActive(lead?.quietHoursNoticeAt, now);
  if (!byClock && !byNotice) return null;
  const kind = /\bunion\b/i.test(requestType) ? 'Union member' : 'Association';
  const phoneZone = validTimeZone(phoneTimeZone, 'UTC');
  const start = zonedInstant(now, IMPACT_TIME_ZONE, QUIET_START_HOUR);
  const startLocal = shortTime(start, phoneZone);
  const sameClock = startLocal === shortTime(start, IMPACT_TIME_ZONE);
  const when = byClock
    ? `Quiet hours started at 7 PM${sameClock ? '' : ` Central (${startLocal} your time)`}`
    : `IMPACT showed its do-not-knock notice at ${shortTime(new Date(lead.quietHoursNoticeAt), phoneZone)}`;
  return {
    title: 'DO NOT KNOCK',
    detail: `${kind} lead · ${when} · Use Next to skip this lead.`
  };
}
