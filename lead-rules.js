// Time-sensitive instructions that need to stand out before a rep calls.
//
// IMPACT's "do not knock after 8 PM" rule for Union / Association leads
// follows IMPACT's clock, not the phone's. The extension sends IMPACT's time
// zone (Options > IMPACT time zone, default Eastern) as lead.impactTimeZone,
// and lead.quietHoursNoticeAt when IMPACT itself shows its after-8 PM notice.

import { validTimeZone, localTimeZone, zonedParts, zonedInstant, timeZoneName } from './time-zone.js';

export const QUIET_START_HOUR = 20; // 8 PM in IMPACT's time zone
export const QUIET_END_HOUR = 6;    // until 6 AM the next morning
const NOTICE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function isQuietHours(now, timeZone) {
  const { hour } = zonedParts(now, timeZone);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

// IMPACT showing its own notice is proof the quiet hours have started. It
// counts for that evening only: at most 12 hours, and never into the daytime.
export function quietHoursNoticeActive(noticeAt, now, timeZone) {
  const at = Date.parse(noticeAt || '');
  if (!Number.isFinite(at) || at > now.getTime() + 60000 || now.getTime() - at > NOTICE_MAX_AGE_MS) return false;
  const { hour } = zonedParts(now, timeZone);
  return !(hour >= QUIET_END_HOUR && hour < 17);
}

function shortTime(date, timeZone) {
  return date.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}

export function doNotKnockWarning(lead, now = new Date(), { phoneTimeZone = localTimeZone() } = {}) {
  const requestType = String(lead?.requestType || '');
  if (!/\b(union|association)\b/i.test(requestType)) return null;
  const impactZone = validTimeZone(lead?.impactTimeZone);
  const byClock = isQuietHours(now, impactZone);
  const byNotice = quietHoursNoticeActive(lead?.quietHoursNoticeAt, now, impactZone);
  if (!byClock && !byNotice) return null;
  const kind = /\bunion\b/i.test(requestType) ? 'Union member' : 'Association';
  const phoneZone = validTimeZone(phoneTimeZone, 'UTC');
  const cutoff = zonedInstant(now, impactZone, QUIET_START_HOUR);
  const cutoffLocal = shortTime(cutoff, phoneZone);
  const sameClock = cutoffLocal === shortTime(cutoff, impactZone);
  const when = byClock
    ? `8 PM ${timeZoneName(impactZone, now)}${sameClock ? '' : ` (${cutoffLocal} your time)`}`
    : `IMPACT showed its after-8 PM notice at ${shortTime(new Date(lead.quietHoursNoticeAt), phoneZone)}`;
  return {
    title: 'DO NOT KNOCK AFTER 8 PM',
    detail: `${kind} lead · ${when} · Use Next to skip this lead.`
  };
}
