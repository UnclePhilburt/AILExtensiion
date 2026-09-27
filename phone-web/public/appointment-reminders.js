// When a saved appointment should come to the front of the lead list.
// Morning (9–11 on that day): text a reminder. Within about an hour: text again.
// The last few minutes: it pops up once more. Callbacks are calls, so they are not reminders.
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

export function reminderText(kind, name) {
  const who = name ? `${name} ` : 'This lead ';
  if (kind === 'starting') return `${who}has an appointment in the next few minutes.`;
  if (kind === 'hour') return `${who}has an appointment coming up within the hour. Text a reminder.`;
  if (kind === 'morning') return `${who}has an appointment today. Text a reminder this morning. Don't call unless you need to.`;
  return '';
}

export const APPOINTMENT_ALERT = "Appointment already scheduled. Don't call unless you need to.";

const RANK = { starting: 0, hour: 1, morning: 2 };

function sameLocalDay(start, now) {
  const a = new Date(start);
  return a.getFullYear() === now.getFullYear() && a.getMonth() === now.getMonth() && a.getDate() === now.getDate();
}

// All-day appointments are stored as Central midnight, which is the appointment's calendar day.
function allDayIsLocalToday(start, now) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(start))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts.year === now.getFullYear() && parts.month === now.getMonth() + 1 && parts.day === now.getDate();
}

export function dueReminders(events, now = new Date()) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.kind !== 'callback')
    .map((event) => ({ ...event, kind: reminderKind(event.startsAt || event.starts_at || event.at, now, Boolean(event.allDay || event.all_day)) }))
    .filter((event) => event.kind && (event.leadId || event.impactLeadId || event.impact_lead_id))
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || Date.parse(a.startsAt || a.starts_at || a.at) - Date.parse(b.startsAt || b.starts_at || b.at));
}
