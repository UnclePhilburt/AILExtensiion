// Builds a gentle, factual summary from a rep's Companion activity. Everything
// here is pure so the page can be tested without a phone or Supabase.
const RESULTS = new Set(['no-answer', 'virtual-appointment', 'refused-appointment']);
const dayKey = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const sameDay = (date, key) => dayKey(date) === key;
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function dailyBrief(events, now = new Date()) {
  const today = dayKey(now);
  const hour = now.getHours();
  const todayEvents = (Array.isArray(events) ? events : []).filter((event) => sameDay(new Date(event.created_at), today));
  const calls = todayEvents.filter((event) => event.event_type === 'call');
  const results = todayEvents.filter((event) => RESULTS.has(event.event_type));
  const appointments = todayEvents.filter((event) => event.event_type === 'virtual-appointment').length;
  const first = calls.map((event) => new Date(event.created_at)).sort((a, b) => a - b)[0];
  const days = new Map();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  for (const event of events || []) {
    const at = new Date(event.created_at);
    if (Number.isNaN(at)) continue;
    const key = dayKey(at);
    if (key === today || at > now) continue;
    // Compare each earlier day only through this same point in its day. A 3 PM
    // check should not be measured against an entire completed workday.
    if (at.getHours() * 60 + at.getMinutes() > minutesNow) continue;
    const item = days.get(key) || { calls: 0, results: 0 };
    if (event.event_type === 'call') item.calls++;
    if (RESULTS.has(event.event_type)) item.results++;
    days.set(key, item);
  }
  const comparable = [...days.values()].filter((item) => item.calls || item.results).slice(-7);
  const averageCalls = comparable.length ? Math.round(comparable.reduce((total, item) => total + item.calls, 0) / comparable.length) : null;
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  let story;
  if (!calls.length) story = hour < 18
    ? 'Your day is still open. When you are ready, one clear next call is enough to begin.'
    : 'No calls have been recorded today. A quiet day can still be a reset for tomorrow.';
  else {
    const elapsedMinutes = Math.max(0, Math.round((now - first) / 60000));
    const elapsed = elapsedMinutes < 60 ? `${elapsedMinutes || 1} minute${elapsedMinutes === 1 ? '' : 's'}` : `${Math.floor(elapsedMinutes / 60)} hour${Math.floor(elapsedMinutes / 60) === 1 ? '' : 's'}${elapsedMinutes % 60 ? ` ${elapsedMinutes % 60} min` : ''}`;
    story = `You started at ${first.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} and have been in motion for ${elapsed}. ${plural(calls.length, 'call')} started`;
    if (results.length) story += ` and ${plural(results.length, 'result')} recorded`;
    story += '.';
  }
  let comparison = comparable.length ? `Your recent daily average is ${plural(averageCalls, 'call')}.` : 'As you use Companion, this page will compare today with your recent days.';
  if (averageCalls !== null && calls.length) comparison = calls.length >= averageCalls
    ? `You are at or ahead of your recent daily pace of ${plural(averageCalls, 'call')}.`
    : `Your recent daily pace is ${plural(averageCalls, 'call')}; there is still time to shape today.`;
  const evening = hour >= 21;
  const reflection = evening
    ? `Tonight's record: ${plural(calls.length, 'call')}, ${plural(results.length, 'outcome')}${appointments ? `, and ${plural(appointments, 'virtual appointment')}` : ''}. Take the win in showing up, then leave yourself one clear starting point for tomorrow.`
    : appointments ? `You have set ${plural(appointments, 'virtual appointment')} today. Keep the next step simple and let each call stand on its own.`
      : 'Stay with the next useful action. Consistency gives the numbers time to become useful.';
  return { greeting, story, comparison, reflection, calls: calls.length, results: results.length, appointments, firstCallAt: first?.toISOString() || null, evening };
}
