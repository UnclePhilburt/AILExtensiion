// Time-sensitive instructions that need to stand out before a rep calls.
//
// Union / Association leads, and any lead with a group (IMPACT shows it where
// the request type is read, e.g. "IBT 610 (SGCOY) (AD&D)"), must not be
// knocked in the evening. On the phone
// the flag starts at 7 PM Central (IMPACT's time zone, IMPACT_TIME_ZONE) and
// lasts until 6 AM. lead.impactTimeZone (older extensions) is ignored.
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

// ---- Group leads ----
// Mirrors findGroupCode in extension/src/content/impact-diagnostic.js (same
// pattern and word lists; src/group-code.test.cjs keeps the two identical).
// A group is a name and number followed by bracketed codes:
// "IBT 610 (SGCOY) (AD&D)", "IUOE 148 (SGK2Q) (AD&D)", "Local 150 (ABC12)".
// The codes must contain a letter, so phone numbers "(555) ..." never match.
const GROUP_CODE = /(?:^|[\s,;:|\-\u2013\u2014])((?:(?:[A-Z][A-Z&.'\/-]*[A-Z&.]|Local|Lodge|District|Council|Chapter)\s+){1,4}#?\d{1,5}[A-Z]?)((?:\s*\((?=[^()]*[A-Za-z])[A-Za-z0-9&\/.' -]{1,20}\))+)/g;
const NOT_GROUP_WORDS = new Set(["APT", "UNIT", "STE", "SUITE", "LOT", "BLDG", "RM", "FL", "BOX", "PO", "HWY", "RTE", "ROUTE", "CR", "SR", "US", "RR", "HC", "EXT", "ST", "AVE", "RD", "DR", "LN", "CT", "HOME", "MOBILE", "WORK", "CELL", "FAX", "PHONE"]);
const GROUP_LEAD_IN = new Set(["REQUEST", "TYPE", "MEMBER", "RESPONSE", "REPLY", "CARD", "CARDS", "LEAD", "GROUP", "NAME", "SOURCE", "UNION", "ASSOCIATION", "THE", "OF", "AND", "FOR"]);
const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export function findGroupCode(text) {
  for (const match of String(text || "").matchAll(GROUP_CODE)) {
    const words = match[1].trim().split(/\s+/);
    const number = words.pop();
    while (words.length > 1 && GROUP_LEAD_IN.has(words[0].toUpperCase())) words.shift();
    const last = words[words.length - 1].toUpperCase().replace(/\./g, "");
    if (NOT_GROUP_WORDS.has(last) || GROUP_LEAD_IN.has(last)) continue;
    if (/^\d{5}$/.test(number) && /^[A-Z]{2}$/.test(last)) continue; // "IL 62704 (...)": a ZIP code
    return cleanText(`${words.join(" ")} ${number} ${match[2].trim()}`);
  }
  return "";
}

// "IBT 610 (SGCOY) (AD&D)" -> "IBT 610" (same as the extension's speakableGroup).
export function speakableGroup(raw) {
  const text = cleanText(raw);
  const spoken = text.replace(/(?:\s*\([^()]*\))+\s*$/, '').replace(/[\s,;:\-\u2013\u2014]+$/, '').trim();
  return (spoken || text).slice(0, 80);
}

// What kind of lead the evening rule applies to, or '' for ordinary leads.
export function quietHoursLeadKind(requestType) {
  const text = String(requestType || '');
  if (/\bunion\b/i.test(text)) return 'Union member';
  if (/\bassociation\b/i.test(text)) return 'Association';
  const group = findGroupCode(text);
  return group ? `${speakableGroup(group)} group` : '';
}

// Badge text: a request type that is only a group reads "Response Card · IBT 610".
export function requestTypeLabel(requestType) {
  const text = cleanText(requestType);
  const group = findGroupCode(text);
  return group && group === text ? `Response Card · ${speakableGroup(group)}` : text;
}

function shortTime(date, timeZone) {
  return date.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}

export function doNotKnockWarning(lead, now = new Date(), { phoneTimeZone = localTimeZone() } = {}) {
  const kind = quietHoursLeadKind(lead?.requestType);
  if (!kind) return null;
  const byClock = isQuietHours(now);
  const byNotice = quietHoursNoticeActive(lead?.quietHoursNoticeAt, now);
  if (!byClock && !byNotice) return null;
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
