import { IMPACT_TIME_ZONE, zonedParts } from './time-zone.js';

export function localDay(now = new Date()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function briefingKey(userId) { return `impact.morningBriefing.v1:${userId}`; }
export function briefingDue(userId, seen, now = new Date()) {
  return Boolean(userId && new Date(now).getHours() >= 8 && seen !== localDay(now));
}
export function briefingDates(now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const since = new Date(today); since.setDate(since.getDate() - 8);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  return { today, yesterday, since, tomorrow };
}
export function scheduleToday(rows, now = new Date()) {
  const key = localDay(now);
  return rows.filter(row => {
    if (!Number.isFinite(Date.parse(row.starts_at))) return false;
    if (!row.all_day) return localDay(row.starts_at) === key;
    // A no-time-preference entry is a calendar date in IMPACT, not a midnight meeting.
    const p = zonedParts(row.starts_at, IMPACT_TIME_ZONE);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}` === key;
  }).sort((a, b) => Number(b.all_day) - Number(a.all_day) || Date.parse(a.starts_at) - Date.parse(b.starts_at));
}
export function callingRecap(events, now = new Date(), activeDay = null) {
  const reference = activeDay ? new Date(activeDay) : new Date(now);
  if (activeDay) reference.setDate(reference.getDate() + 1);
  const { today, yesterday, since } = briefingDates(reference);
  const calls = events.filter(e => e.event_type === 'call' && Date.parse(e.created_at) >= since && Date.parse(e.created_at) < today);
  const yesterdayCalls = calls.filter(e => Date.parse(e.created_at) >= yesterday).length;
  const days = new Map();
  for (const call of calls.filter(e => Date.parse(e.created_at) < yesterday)) {
    const key = localDay(call.created_at); days.set(key, (days.get(key) || 0) + 1);
  }
  let insight = 'A few more calling days will give us enough history for a useful comparison.';
  if (days.size >= 3) {
    const average = [...days.values()].reduce((a,b) => a+b,0) / days.size;
    const difference = Math.round(yesterdayCalls - average);
    insight = `On your last active day you started ${yesterdayCalls} calls, ${difference === 0 ? 'about the same as' : `${Math.abs(difference)} ${difference > 0 ? 'above' : 'below'}`} your average of ${Math.round(average)} across ${days.size} active calling days in the previous week.`;
  }
  return { yesterdayCalls, insight };
}
export function morningMessage(userId, now, calls, scheduled) {
  const lines = [
    'You do not have to carry the whole day at once. Give the next conversation your attention, and let the day grow from there.',
    'A steady day begins with a little room to breathe. Settle in, find your next useful step, and take it at your own pace.',
    'Today is a fresh page. You can bring what you learned yesterday without bringing every unanswered call along with it.',
    'Leave room for a good conversation. Listen carefully, follow through, and let small, thoughtful actions add up.',
    'You do not need a perfect morning to have a worthwhile day. Begin with what is in front of you.'
  ];
  const seed = [...`${userId}:${localDay(now)}`].reduce((n,c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
  return `${scheduled ? 'There are people on your calendar today; give those commitments room first. ' : calls ? 'Your last active day’s effort is recorded. You can begin again from here. ' : ''}${lines[seed % lines.length]}`;
}

export function nextBriefingDelay(now = new Date()) {
  const next = new Date(now); next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}
