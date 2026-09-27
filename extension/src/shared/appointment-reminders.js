// Same reminder windows as the phone. Kept here so the extension can reorder the lead list.
export function reminderKind(startsAt, now = new Date(), allDay = false) {
  const start = startsAt instanceof Date ? startsAt.getTime() : Date.parse(startsAt);
  if (!Number.isFinite(start)) return '';
  const until = start - now.getTime();
  if (allDay) {
    if (!allDayIsLocalToday(start, now) || now.getHours() < 9 || now.getHours() >= 11) return '';
    return 'morning';
  }
  if (until <= 12 * 60 * 1000 && until > -5 * 60 * 1000) return 'starting';
  if (until <= 80 * 60 * 1000 && until > 12 * 60 * 1000) return 'hour';
  if (sameLocalDay(start, now) && now.getHours() >= 9 && now.getHours() < 11 && until > 80 * 60 * 1000) return 'morning';
  return '';
}

function sameLocalDay(start, now) {
  const a = new Date(start);
  return a.getFullYear() === now.getFullYear() && a.getMonth() === now.getMonth() && a.getDate() === now.getDate();
}

function allDayIsLocalToday(start, now) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(start))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts.year === now.getFullYear() && parts.month === now.getMonth() + 1 && parts.day === now.getDate();
}

export function dueReminders(events, now = new Date()) {
  const rank = { starting: 0, hour: 1, morning: 2 };
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.kind !== 'callback')
    .map((event) => ({
      leadId: String(event.impact_lead_id || event.leadId || ''),
      name: event.lead_name || event.name || '',
      startsAt: event.starts_at || event.startsAt,
      kind: reminderKind(event.starts_at || event.startsAt, now, Boolean(event.all_day || event.allDay))
    }))
    .filter((event) => event.kind && event.leadId)
    .sort((a, b) => rank[a.kind] - rank[b.kind] || Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
