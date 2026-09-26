// Builds a gentle, factual summary from a rep's Companion activity. Everything
// here is pure so the page can be tested without a phone or Supabase.
const RESULTS = new Set(['no-answer', 'virtual-appointment', 'refused-appointment']);
const dayKey = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const sameDay = (date, key) => dayKey(date) === key;
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const choose = (choices, seed) => choices[Math.abs(seed) % choices.length];
const seedFor = (key, calls, results) => [...key].reduce((total, char) => total + char.charCodeAt(0), 0) + calls * 7 + results * 13;

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
  const seed = seedFor(today, calls.length, results.length);
  let chapters;
  if (!calls.length) chapters = hour < 18
    ? [choose(['The page is still blank, which means the day has not decided its shape yet.', 'The day is waiting quietly at the edge of its first call.', 'Nothing has been written into the call log yet. There is still plenty of room for the first line.'], seed), 'When you are ready, one clear next call is enough to begin the story.']
    : [choose(['The call log stayed quiet today. Not every chapter is written at full speed.', 'There were no calls recorded today, and the page can be allowed to rest.', 'Tonight the record is quiet. A quiet record can still make room for a better beginning tomorrow.'], seed), 'Leave yourself one small starting point for the morning, then let the day be finished.'];
  else {
    const elapsedMinutes = Math.max(0, Math.round((now - first) / 60000));
    const elapsed = elapsedMinutes < 60 ? `${elapsedMinutes || 1} minute${elapsedMinutes === 1 ? '' : 's'}` : `${Math.floor(elapsedMinutes / 60)} hour${Math.floor(elapsedMinutes / 60) === 1 ? '' : 's'}${elapsedMinutes % 60 ? ` ${elapsedMinutes % 60} min` : ''}`;
    const firstTime = first.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const opening = choose([`At ${firstTime}, the day began with the first number dialed.`, `The first call went out at ${firstTime}, and the day found its opening line.`, `At ${firstTime}, you put the first mark on today's page.`], seed);
    const middle = results.length
      ? choose([`Since then, ${plural(calls.length, 'call')} have started and ${plural(results.length, 'outcome')} have found their way into the record.`, `The middle of the day has carried ${plural(calls.length, 'call')} and ${plural(results.length, 'recorded outcome')}.`, `From that first call came ${plural(calls.length, 'attempt')} and ${plural(results.length, 'clear result')}.`], seed + 1)
      : choose([`Since then, ${plural(calls.length, 'call')} have gone out, each one moving the day forward.`, `The day has collected ${plural(calls.length, 'call')} so far, with the next page still unwritten.`, `${plural(calls.length, 'call')} have begun the rhythm of the day; the outcomes will arrive in their own time.`], seed + 1);
    const appointmentLine = appointments ? ` One of those moments became ${plural(appointments, 'virtual appointment')}, a small piece of tomorrow already placed on the calendar.` : '';
    chapters = [opening, `${middle}${appointmentLine}`, `You have been at it for ${elapsed}.`];
  }
  let comparison = comparable.length ? `Your recent daily average is ${plural(averageCalls, 'call')}.` : 'As you use Companion, this page will compare today with your recent days.';
  if (averageCalls !== null && calls.length) comparison = calls.length >= averageCalls
    ? `You are at or ahead of your recent daily pace of ${plural(averageCalls, 'call')}.`
    : `Your recent daily pace is ${plural(averageCalls, 'call')}; there is still time to shape today.`;
  const evening = hour >= 21;
  const reflection = evening
    ? choose([`Tonight, the page closes with ${plural(calls.length, 'call')} and ${plural(results.length, 'outcome')}. The useful work is recorded; the rest can wait until tomorrow.`, `The evening has arrived. ${plural(calls.length, 'call')} now belong to today's story, along with ${plural(results.length, 'outcome')}. Let that be enough for tonight.`, `This chapter ends with ${plural(calls.length, 'call')} and ${plural(results.length, 'outcome')}. Keep one note for tomorrow, then give the day permission to be complete.`], seed + 2)
    : appointments ? `A future appointment is now part of the story. Keep the next step simple and let each call stand on its own.`
      : choose(['There is no need to rush the next page. Stay with the next useful action.', 'The story only asks for the next honest attempt, not the entire ending at once.', 'Keep the pace human. One call can be a complete piece of work.'], seed + 2);
  return { greeting, story: chapters.join(' '), chapters, comparison, reflection, calls: calls.length, results: results.length, appointments, firstCallAt: first?.toISOString() || null, evening };
}
