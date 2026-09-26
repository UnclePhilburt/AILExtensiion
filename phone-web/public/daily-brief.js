// Builds a gentle, factual summary from a rep's Companion activity. Everything
// here is pure so the page can be tested without a phone or Supabase.
const RESULTS = new Set(['no-answer', 'virtual-appointment', 'refused-appointment']);
const dayKey = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const sameDay = (date, key) => dayKey(date) === key;
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const choose = (choices, seed) => choices[Math.abs(seed) % choices.length];
const seedFor = (key, calls, results) => [...key].reduce((total, char) => total + char.charCodeAt(0), 0) + calls * 7 + results * 13;
// These are story ingredients rather than quotes. Each chapter combines several
// of them with the rep's real activity, so it changes as their day changes.
const OPENINGS = [
  'the day began with the first number dialed', 'the first call went out and the page opened', 'you put the first mark on today\'s page',
  'the workday found its first small bit of momentum', 'the quiet before the calls gave way to the first attempt', 'the first voice-mail tone or conversation set the day in motion',
  'you stepped into the day one number at a time', 'the first lead became the doorway into the rest of the afternoon', 'the call log stopped being empty and became a record of effort',
  'the first attempt made the day real', 'you started building the day before it had a chance to build itself', 'the first call made room for everything that followed'
];
const CALL_MIDDLES = [
  'The calls have arrived one by one, without asking you to solve the whole day at once.', 'Each attempt has been a small decision to keep the line moving.',
  'The middle of the day is made of ordinary calls, and ordinary calls are where momentum lives.', 'The list has been getting shorter one honest attempt at a time.',
  'There is a rhythm now: read, dial, listen, record, and begin again.', 'The work has not needed to be dramatic to be real.',
  'A few minutes at a time, the page has filled itself in.', 'The calls have given the afternoon a shape.',
  'What looked like a list at the start has become a series of finished moments.', 'The work has stayed close to the next number, which is enough.',
  'The day has kept moving through the small spaces between one call and the next.', 'Every attempt has made the next decision a little clearer.'
];
const NO_ANSWER_LINES = [
  'Some doors stayed closed, and those calls still count as work completed.', 'A few rings led nowhere; that is part of calling, not a verdict on the day.',
  'The unanswered calls have been recorded and released instead of carried with you.', 'Not every number opened today, but each one is no longer an unknown.',
  'The quiet on the other end has become useful information for a later try.', 'No answer is still an answer about this moment, and you kept going.',
  'A handful of calls found silence. You gave them their chance and moved forward.', 'The missed connections belong to the process, not to you.',
  'Some phones did not pick up; the list still moved because you did.', 'The unanswered moments are now behind you, where they belong.',
  'The day included some silence, and you met it by making the next attempt.', 'Each no-answer cleared a little space for a better-timed conversation later.'
];
const APPOINTMENT_LINES = [
  'A future appointment is now waiting on the calendar, a quiet bridge between today and what comes next.', 'One of today\'s calls became a real place on the calendar.',
  'The day has already sent something forward: an appointment with a future attached to it.', 'A conversation turned into a next step, and that is a meaningful turn in the chapter.',
  'There is now a promise of another conversation waiting beyond today.', 'An appointment has given the work a second scene to return to.',
  'Today made room for a future meeting.', 'One call reached past the present and placed something on the calendar.',
  'The story did not end at the call; it carried forward into an appointment.', 'A future time now holds the thread you started today.',
  'The calendar has one more reason to matter because of the work you did here.', 'A next conversation has been earned and set aside for its own moment.'
];
const REFUSAL_LINES = [
  'Some conversations closed a door clearly, which is kinder than leaving it half open.', 'A refusal gave you an honest ending instead of a question to keep carrying.',
  'Not every conversation became a yes, but clear answers keep the path clean.', 'A few doors closed, and the work moved on with more certainty.',
  'The noes were part of the map too; they showed you where not to spend another hour.', 'A refusal is a finished sentence, and finished sentences make room for the next page.',
  'Some answers were not the answer you wanted, but they were still real answers.', 'The day made room for clarity, even when clarity meant letting a lead go.',
  'A clear no can be a useful kind of progress.', 'The conversations that ended still gave the day a shape.',
  'You did not have to force every door open for the day to move forward.', 'The honest endings made the remaining possibilities easier to see.'
];
const PAUSE_LINES = [
  'There is no need to rush the next page. Stay with the next useful action.', 'The story only asks for the next honest attempt, not the entire ending at once.',
  'Keep the pace human. One call can be a complete piece of work.', 'You do not need to outrun the day; you only need to meet the next call.',
  'Let the next small action be enough for this moment.', 'A steady page is better than a frantic one.',
  'The list can wait for the breath between calls.', 'There is room here to be deliberate.',
  'Take the next call as it comes, not as proof of anything larger.', 'The day responds well to a calm next step.',
  'You are allowed to make this a series of small wins.', 'The work becomes lighter when the next step is the only step in view.'
];
const EVENING_LINES = [
  'The useful work is recorded; the rest can wait until tomorrow.', 'Leave one small starting point for morning, then let the day be finished.',
  'The calls are no longer waiting for you. They belong to today now.', 'Nothing more needs to be proved tonight.',
  'You can set the list down without losing the work you did.', 'Tomorrow will have its own opening line.',
  'The chapter has an ending, and endings are part of doing this well.', 'Let the unfinished pieces stay unfinished until they are tomorrow\'s work.',
  'The day has said what it had to say. You can listen and close the page.', 'A good ending is simply knowing where to begin again.',
  'The record is here when you return; you do not have to hold it in your head.', 'The work can rest now, and so can you.'
];

export function dailyBrief(events, now = new Date()) {
  const today = dayKey(now);
  const hour = now.getHours();
  const todayEvents = (Array.isArray(events) ? events : []).filter((event) => sameDay(new Date(event.created_at), today));
  const calls = todayEvents.filter((event) => event.event_type === 'call');
  const results = todayEvents.filter((event) => RESULTS.has(event.event_type));
  const noAnswers = todayEvents.filter((event) => event.event_type === 'no-answer').length;
  const appointments = todayEvents.filter((event) => event.event_type === 'virtual-appointment').length;
  const refusals = todayEvents.filter((event) => event.event_type === 'refused-appointment').length;
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
    const opening = `At ${firstTime}, ${choose(OPENINGS, seed)}.`;
    const middle = `${choose(CALL_MIDDLES, seed + 1)} So far, ${plural(calls.length, 'call')} have started${results.length ? ` and ${plural(results.length, 'outcome')} have been recorded` : ''}.`;
    const outcomes = [];
    if (noAnswers) outcomes.push(`${choose(NO_ANSWER_LINES, seed + 2)} (${plural(noAnswers, 'no-answer')})`);
    if (appointments) outcomes.push(`${choose(APPOINTMENT_LINES, seed + 3)} (${plural(appointments, 'appointment')})`);
    if (refusals) outcomes.push(`${choose(REFUSAL_LINES, seed + 4)} (${plural(refusals, 'refusal')})`);
    chapters = [opening, middle, ...outcomes, `You have been at it for ${elapsed}. ${choose(PAUSE_LINES, seed + 5)}`];
  }
  let comparison = comparable.length ? `Your recent daily average is ${plural(averageCalls, 'call')}.` : 'As you use Companion, this page will compare today with your recent days.';
  if (averageCalls !== null && calls.length) comparison = calls.length >= averageCalls
    ? `You are at or ahead of your recent daily pace of ${plural(averageCalls, 'call')}.`
    : `Your recent daily pace is ${plural(averageCalls, 'call')}; there is still time to shape today.`;
  const evening = hour >= 21;
  const reflection = evening
    ? `Tonight, the page closes with ${plural(calls.length, 'call')} and ${plural(results.length, 'outcome')}. ${choose(EVENING_LINES, seed + 6)}`
    : appointments ? `A future appointment is now part of the story. ${choose(PAUSE_LINES, seed + 6)}`
      : choose(PAUSE_LINES, seed + 6);
  return { greeting, story: chapters.join(' '), chapters, comparison, reflection, calls: calls.length, results: results.length, appointments, firstCallAt: first?.toISOString() || null, evening };
}
