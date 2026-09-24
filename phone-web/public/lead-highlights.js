// Builds the phone's "Heads-up" chips from the lead's IMPACT Status history.
//
// The only lead data IMPACT gives the phone today about past activity is the
// Status list, one entry per line, in the form confirmed from IMPACT:
//   "No Answer on Sep 23 2026 04:48 PM by Me."
//   "Reschedule appointment on Sep 22 2026 06:30 PM by Me."
// Anything else here is keyword matching on that same text, so a chip only
// appears when the words are actually in IMPACT's history.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const DAY = 24 * 60 * 60 * 1000;
const DATE_PATTERN = new RegExp(
  '\\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})' +
  '|(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4}))' +
  '(?:,?\\s+(?:at\\s+)?(\\d{1,2}):(\\d{2})(?::\\d{2})?\\s*([ap])\\.?m\\.?)?', 'gi');

export function findDates(text) {
  const found = [];
  for (const match of String(text || '').matchAll(DATE_PATTERN)) {
    const month = match[1] ? MONTHS[match[1].toLowerCase()] : Number(match[4]) - 1;
    const day = Number(match[2] || match[5]);
    const year = Number(match[3] || match[6]);
    let hour = 0, minute = 0;
    const hasTime = Boolean(match[7]);
    if (hasTime) {
      hour = Number(match[7]) % 12 + (/p/i.test(match[9]) ? 12 : 0);
      minute = Number(match[8]);
    }
    const date = new Date(year, month, day, hour, minute);
    if (Number.isNaN(date.getTime()) || date.getMonth() !== month || date.getDate() !== day) continue;
    found.push({ at: date.getTime(), hasTime, index: match.index, length: match[0].length });
  }
  return found;
}

export function classifyEntry(text) {
  const value = String(text || '');
  if (/\b(do not call|dnc|bad (phone|number)|wrong number|disconnected|invalid number)\b/i.test(value)) return 'bad-number';
  if (/\b(not interested|refused|declined)\b/i.test(value)) return 'refused';
  if (/\b(cancel(l?ed)?|no[- ]?show|missed)\b/i.test(value) && /\b(appointment|appt)\b/i.test(value)) return 'appointment-missed';
  if (/\b(appointment|appt)\b/i.test(value)) return 'appointment';
  if (/\bcall[- ]?back\b/i.test(value)) return 'callback';
  if (/\b(no answer|voice ?mail|left (a )?message|busy)\b/i.test(value)) return 'attempt';
  return 'other';
}

export function parseHistoryEntry(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  const dates = findDates(value);
  // "Action on <date> by Someone." The action is the text before " on <date>".
  const first = dates[0];
  let action = value;
  if (first) action = value.slice(0, first.index).replace(/\s+(on|for|at)\s*$/i, '');
  else action = value.replace(/\s+by\s+[^.]{1,100}\.?$/i, '');
  const by = value.match(/\bby\s+([^.]{1,100})\.?\s*$/i)?.[1] || '';
  return { text: value, action: action.trim().replace(/[.:,]$/, '') || value, by, dates, kind: classifyEntry(value) };
}

function startOfDay(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

export function formatWhen(at, hasTime) {
  const d = new Date(at);
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return hasTime ? `${date}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : date;
}

export function relativeTime(at, now, hasTime = true) {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY);
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

// Returns chips, most important first:
//   { tone, label, title, detail, soon }
// tone: 'appointment' | 'callback' | 'danger' | 'neutral'
export function buildHeadsUp(callHistory, now, { max = 4 } = {}) {
  if (!Array.isArray(callHistory) || !callHistory.length) return [];
  const entries = callHistory.map(parseHistoryEntry).filter((entry) => entry.text);
  const chips = [];
  const whenOf = (entry) => entry.dates.find((date) => date.at > now + 60000) || entry.dates[0];
  const add = (chip) => { if (chip && !chips.some((c) => c.title === chip.title && c.detail === chip.detail)) chips.push(chip); };
  const describe = (entry, date) => date ? `${formatWhen(date.at, date.hasTime)} · ${relativeTime(date.at, now, date.hasTime)}` : '';

  const rank = (entry) => entry.kind === 'appointment' ? 0 : entry.kind === 'callback' ? 1 : 2;
  // A date in the future can't be when something was recorded, so it is
  // something scheduled: show the nearest ones first.
  const upcoming = entries
    .map((entry) => ({ entry, date: entry.dates.filter((d) => d.at > now + 60000).sort((a, b) => a.at - b.at)[0] }))
    .filter((item) => item.date)
    // Appointments first, then callbacks, then anything else; nearest first within each.
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.date.at - b.date.at);
  for (const { entry, date } of upcoming) {
    const soon = date.at - now < DAY;
    const tone = entry.kind === 'callback' ? 'callback' : entry.kind.startsWith('appointment') ? 'appointment' : 'neutral';
    const label = entry.kind === 'callback' ? 'Callback set' : entry.kind === 'appointment' ? 'Upcoming appointment' : 'Scheduled';
    add({ tone, label, title: entry.action, detail: describe(entry, date), soon, at: date.at });
  }

  const past = (entry) => { const date = entry.dates[0]; return !date || date.at <= now + 60000; };
  const newestFirst = (a, b) => (b.dates[0]?.at || 0) - (a.dates[0]?.at || 0);
  const recent = (kinds, days) => entries.filter((e) => kinds.includes(e.kind) && past(e) &&
    (!e.dates[0] || now - e.dates[0].at <= days * DAY)).sort(newestFirst)[0];

  const warning = entries.filter((e) => ['bad-number', 'refused', 'appointment-missed'].includes(e.kind) && past(e)).sort(newestFirst)[0];
  if (warning) {
    const label = warning.kind === 'bad-number' ? 'Check the number' : warning.kind === 'refused' ? 'Refused before' : 'Missed / cancelled appointment';
    add({ tone: 'danger', label, title: warning.action, detail: describe(warning, warning.dates[0]) });
  }
  if (!upcoming.some((u) => u.entry.kind === 'appointment')) {
    const appointment = recent(['appointment'], 30);
    if (appointment) add({ tone: 'appointment', label: 'Recent appointment activity', title: appointment.action, detail: describe(appointment, appointment.dates[0]), muted: true });
  }
  if (!upcoming.some((u) => u.entry.kind === 'callback')) {
    const callback = recent(['callback'], 14);
    if (callback) add({ tone: 'callback', label: 'Recent callback', title: callback.action, detail: describe(callback, callback.dates[0]), muted: true });
  }

  const attempts = entries.filter((e) => e.kind === 'attempt' && past(e));
  if (attempts.length) {
    const latest = [...entries].filter(past).sort(newestFirst)[0];
    const today = entries.filter((e) => e.dates[0] && startOfDay(e.dates[0].at) === startOfDay(now) && past(e)).length;
    const noAnswers = attempts.filter((e) => /no answer/i.test(e.text)).length;
    const title = noAnswers ? `${noAnswers} no answer${noAnswers === 1 ? '' : 's'}` : `${attempts.length} attempt${attempts.length === 1 ? '' : 's'}`;
    const lastDate = latest?.dates[0];
    const last = lastDate ? `Last: ${latest.action} ${relativeTime(lastDate.at, now, lastDate.hasTime)}` : `Last: ${latest?.action || ''}`;
    add({ tone: 'neutral', label: 'Previous tries', title,
      detail: [last, today ? `${today} logged today` : ''].filter(Boolean).join(' · ') });
  }
  return chips.slice(0, max);
}
