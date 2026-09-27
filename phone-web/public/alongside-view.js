// Pure numbers for Alongside. The page paints them; nothing here touches the network.
import { rangeStart } from './statistics-view.js';
import { formatApl } from './appointment-outcomes.js';

export const ALONGSIDE_RANGES = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time']];
export const ALONGSIDE_METRICS = [
  ['held', 'Held'],
  ['scheduled', 'Scheduled'],
  ['calls', 'Calls'],
  ['apl', 'APL'],
  ['referrals', 'Referrals'],
  ['noShows', 'No-shows']
];

export function alongsideSince(range, now = new Date()) {
  if (range === 'all') return null;
  return rangeStart(range === 'today' ? 'today' : range, now);
}

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function personFromRow(row) {
  return {
    name: String(row.display_name || row.displayName || 'A teammate'),
    isSelf: Boolean(row.is_self ?? row.isSelf),
    calls: num(row.calls),
    scheduled: num(row.scheduled),
    refused: num(row.refused),
    noAnswers: num(row.no_answers ?? row.noAnswers),
    held: num(row.held),
    noShows: num(row.no_shows ?? row.noShows),
    rescheduled: num(row.rescheduled),
    apl: num(row.apl),
    referrals: num(row.referrals)
  };
}

export function tallySelf(events, outcomes, name = 'You') {
  const list = Array.isArray(events) ? events : [];
  const rows = Array.isArray(outcomes) ? outcomes : [];
  const count = (type) => list.filter((event) => event.event_type === type).length;
  return {
    name: name || 'You',
    isSelf: true,
    calls: count('call'),
    scheduled: count('virtual-appointment'),
    refused: count('refused-appointment'),
    noAnswers: count('no-answer'),
    held: rows.filter((row) => row.status === 'held').length,
    noShows: rows.filter((row) => row.status === 'no-show').length,
    rescheduled: rows.filter((row) => row.status === 'rescheduled').length,
    apl: rows.reduce((sum, row) => sum + num(row.apl), 0),
    referrals: rows.reduce((sum, row) => sum + num(row.referrals), 0)
  };
}

export function metricOf(person, metric) {
  return num(person?.[metric]);
}

export function sortAlongside(people, metric) {
  return [...(people || [])].sort((a, b) => metricOf(b, metric) - metricOf(a, metric) || Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name));
}

export function heldShare(person) {
  const scheduled = num(person?.scheduled);
  const held = num(person?.held);
  if (!scheduled) return 0;
  return Math.max(0, Math.min(1, held / scheduled));
}

export function alongsideSentence(person) {
  const who = person?.isSelf ? 'You' : (person?.name || 'A teammate');
  const calls = num(person?.calls);
  const set = num(person?.scheduled);
  const held = num(person?.held);
  const apl = num(person?.apl);
  const referrals = num(person?.referrals);
  if (!calls && !set && !held && !apl && !referrals) {
    return person?.isSelf ? 'A quiet stretch. Nothing is recorded in this period yet.' : `${who} is quiet in this period.`;
  }
  const parts = [];
  if (calls) parts.push(`${calls} call${calls === 1 ? '' : 's'}`);
  if (set || held) parts.push(`${set} set, ${held} held`);
  if (apl) parts.push(formatApl(apl));
  if (referrals) parts.push(`${referrals} referral${referrals === 1 ? '' : 's'}`);
  return `${who} · ${parts.join(' · ')}`;
}

const two = (value) => String(value).padStart(2, '0');
const dayKey = (date) => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;

function entriesFor(events, outcomes, metric) {
  const out = [];
  const put = (at, value) => { const time = new Date(at); if (!Number.isNaN(time.getTime())) out.push({ at: time, value: num(value) }); };
  const list = Array.isArray(events) ? events : [];
  const rows = Array.isArray(outcomes) ? outcomes : [];
  if (metric === 'calls') for (const event of list) if (event.event_type === 'call') put(event.created_at, 1);
  if (metric === 'scheduled') for (const event of list) if (event.event_type === 'virtual-appointment') put(event.created_at, 1);
  if (metric === 'held') for (const row of rows) if (row.status === 'held') put(row.created_at, 1);
  if (metric === 'apl') for (const row of rows) put(row.created_at, row.apl);
  if (metric === 'referrals') for (const row of rows) put(row.created_at, row.referrals);
  if (metric === 'noShows') for (const row of rows) if (row.status === 'no-show') put(row.created_at, 1);
  return out;
}

// Buckets for the personal rhythm line. Future slots stay in place with a null value.
export function rhythmBuckets(events, outcomes, metric, range, now = new Date()) {
  const items = entriesFor(events, outcomes, metric).filter((item) => {
    const start = alongsideSince(range, now);
    return !start || item.at >= start;
  });
  const sum = (matches) => matches.reduce((total, item) => total + item.value, 0);
  if (range === 'today') {
    return Array.from({ length: 12 }, (_, index) => {
      const hour = index + 8;
      const label = hour === 12 ? '12' : String(hour > 12 ? hour - 12 : hour);
      const value = hour > now.getHours() ? null : sum(items.filter((item) => item.at.getHours() === hour));
      return { label, value };
    });
  }
  if (range === 'week') {
    const start = alongsideSince('week', now);
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return names.map((label, index) => {
      const day = new Date(start); day.setDate(start.getDate() + index);
      const value = day > now ? null : sum(items.filter((item) => dayKey(item.at) === dayKey(day)));
      return { label, value };
    });
  }
  if (range === 'year' || range === 'all') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (range === 'year') {
      return months.map((label, index) => ({
        label,
        value: index > now.getMonth() ? null : sum(items.filter((item) => item.at.getMonth() === index && item.at.getFullYear() === now.getFullYear()))
      }));
    }
    const years = [...new Set(items.map((item) => item.at.getFullYear()))].sort((a, b) => a - b);
    const list = years.length ? years : [now.getFullYear()];
    return list.map((year) => ({ label: String(year), value: sum(items.filter((item) => item.at.getFullYear() === year)) }));
  }
  const start = alongsideSince('month', now);
  const last = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  return Array.from({ length: last }, (_, index) => {
    const day = new Date(start); day.setDate(index + 1);
    return { label: String(index + 1), value: day > now ? null : sum(items.filter((item) => dayKey(item.at) === dayKey(day))) };
  });
}
