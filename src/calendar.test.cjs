const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '../phone-web/public', file), 'utf8');
const strip = (source) => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const eventsSource = strip(`${read('time-zone.js')}\n${read('lead-highlights.js')}\n${read('calendar-events.js')}`);
function calendar(extra = {}) { const context = vm.createContext({ ...extra }); vm.runInContext(eventsSource, context); return context; }
const cal = calendar();
const plain = (value) => JSON.parse(JSON.stringify(value));
// Sep 2026: Central (IMPACT) = UTC-5.
const ct = (day, hour = 10, minute = 0, month = 8) => Date.UTC(2026, month, day, hour + 5, minute);
const now = ct(24); // Thu Sep 24 2026, 10:00 AM Central
const realLead = [
  'No Answer on Sep 23 2026 09:38 PM by Me',
  'Schedule Call Back appointment on Sep 24 2026 - No Time Preference by Me',
  'Checkin on Sep 22 2026 04:41 PM by Me',
  'Schedule Virtual Appointment on Sep 22 2026 03:00 PM by Me',
  'SetVirtualAppt by Me'
];

test('history → the current appointment and callback, in Central time', () => {
  assert.deepEqual(plain(cal.scheduleFromHistory(realLead)), [
    { kind: 'virtual-appointment', startsAt: new Date(ct(22, 15)).toISOString(), allDay: false, source: 'history', sourceLine: 'Schedule Virtual Appointment on Sep 22 2026 03:00 PM by Me' },
    { kind: 'callback', startsAt: new Date(ct(24, 0)).toISOString(), allDay: true, source: 'history', sourceLine: 'Schedule Call Back appointment on Sep 24 2026 - No Time Preference by Me' }
  ]);
});

test('a newer Schedule/Reschedule line wins; plain appointments; lines run together are split', () => {
  const events = plain(cal.scheduleFromHistory(['No Answer on Sep 23 2026 04:48 PM by Me.Reschedule appointment on Sep 25 2026 06:30 PM by Me.', 'Schedule Virtual Appointment on Sep 22 2026 03:00 PM by Me']));
  assert.deepEqual(events.map((e) => [e.kind, e.startsAt, e.allDay]), [['appointment', new Date(ct(25, 18, 30)).toISOString(), false]]);
});

test('only schedules set by Me count; a newer one by someone else hides older ones', () => {
  assert.deepEqual(plain(cal.scheduleFromHistory(['Schedule Virtual Appointment on Sep 25 2026 01:00 PM by Pat Smith', 'Schedule Virtual Appointment on Sep 22 2026 03:00 PM by Me'])), []);
  assert.deepEqual(plain(cal.scheduleFromHistory(['No Answer on Sep 23 2026 09:38 PM by Me', 'Checkin on Sep 22 2026 04:41 PM by Me'])), []);
  assert.deepEqual(plain(cal.scheduleFromHistory(undefined)), []);
});

test('lead snapshot: IMPACT id as the key, Mobile phone preferred, lengths capped', () => {
  const lead = { leadId: '123', leadName: '  Jane   Sample ', address: '1 Main St', requestType: 'Union Member Request', phones: [{ label: 'Home', number: '555-0101' }, { label: 'Mobile', number: '555-0100' }] };
  assert.deepEqual(plain(cal.leadSnapshot(lead)), { leadKey: 'lead:123', leadId: '123', leadName: 'Jane Sample', phone: '555-0100', address: '1 Main St', requestType: 'Union Member Request' });
  assert.equal(cal.leadKeyFor({ leadName: 'A', phones: [{ number: '1' }] }), 'A::::::1');
  assert.equal(cal.leadKeyFor({}), '');
  assert.equal(cal.leadSnapshot({ leadId: 'x', leadName: 'n'.repeat(500) }).leadName.length, 200);
});

test('Set Virtual Appointment day labels: clear dates only', () => {
  const day = (label, at = now) => plain(cal.parseSlotDay(label, at));
  assert.deepEqual(day('Today'), { year: 2026, month: 8, day: 24 });
  assert.deepEqual(day('Tomorrow'), { year: 2026, month: 8, day: 25 });
  assert.deepEqual(day('Thu 9/24'), { year: 2026, month: 8, day: 24 });
  assert.deepEqual(day('10/02/2026'), { year: 2026, month: 9, day: 2 });
  assert.deepEqual(day('Fri, Sep 25'), { year: 2026, month: 8, day: 25 });
  assert.deepEqual(day('Jan 4', ct(28, 10, 0, 11)), { year: 2027, month: 0, day: 4 }, 'next January from late December');
  assert.equal(day('Friday'), null, 'weekday alone is not a date');
  assert.equal(day('2/30'), null);
  assert.equal(day(''), null);
});

test('an appointment chosen on the phone becomes a Central-time event', () => {
  assert.deepEqual(plain(cal.appointmentChoiceEvent('Fri 9/25', '03:00 PM', now)), { kind: 'virtual-appointment', startsAt: new Date(ct(25, 15)).toISOString(), allDay: false, source: 'phone', sourceLine: 'Set from the phone: Fri 9/25 · 03:00 PM' });
  assert.equal(plain(cal.appointmentChoiceEvent('Today', 'Right Now', now)).allDay, true, 'No Time Preference slot');
  assert.equal(cal.appointmentChoiceEvent('Today', 'soon', now), null);
  assert.equal(cal.appointmentChoiceEvent('Someday', '03:00 PM', now), null);
});

test('month grid: 6 Sunday-first weeks with today marked', () => {
  const weeks = plain(cal.monthGrid(2026, 8, '2026-09-24'));
  assert.equal(weeks.length, 6);
  assert.deepEqual(weeks[0].map((c) => c.key), ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
  assert.equal(weeks[0][0].inMonth, false);
  assert.deepEqual(weeks.flat().filter((c) => c.isToday).map((c) => c.key), ['2026-09-24']);
  assert.deepEqual(plain(cal.shiftMonth(2026, 11, 1)), { year: 2027, month: 0 });
  assert.deepEqual(plain(cal.shiftMonth(2026, 0, -1)), { year: 2025, month: 11 });
  assert.equal(cal.monthLabel(2026, 8), 'September 2026');
});

test('rows are grouped by Central day, any-time first; past, today and upcoming', () => {
  const row = (id, kind, at, allDay = false, name = `Lead ${id}`) => ({ id, kind, starts_at: new Date(at).toISOString(), all_day: allDay, lead_name: name, phone: '555-0100' });
  const events = [
    row(1, 'virtual-appointment', ct(24, 15)), row(2, 'callback', ct(24, 0), true), row(3, 'appointment', ct(24, 9)),
    row(4, 'callback', ct(24, 23, 30)), // 11:30 PM Central is Sep 25 in UTC but Sep 24 in IMPACT
    row(5, 'appointment', ct(10, 0, 0, 9)), row(6, 'appointment', ct(8, 12, 0, 9)), { id: 7, kind: 'meeting', starts_at: 'x' }
  ].map(cal.normalizeEvent).filter(Boolean);
  assert.equal(events.length, 6);
  const day = cal.groupByDay(events).get('2026-09-24');
  assert.deepEqual(plain(day.map((e) => e.id)), [2, 3, 1, 4]);
  assert.deepEqual(plain(day.map((e) => cal.eventStatus(e, now))), ['today', 'past', 'today', 'today']);
  assert.deepEqual(plain(day.map((e) => cal.formatEventTime(e))), ['Any time', '9:00 AM', '3:00 PM', '11:30 PM']);
  assert.deepEqual(plain(cal.upcomingEvents(events, now).map((e) => e.id)), [2, 1, 4, 6], 'next 14 days, not past; Oct 10 is beyond');
  assert.equal(cal.eventStatus(cal.normalizeEvent(row(8, 'callback', ct(23, 0), true)), now), 'past');
  assert.equal(cal.dayHeading('2026-09-24', '2026-09-24'), 'Today · Thursday, Sep 24');
  assert.equal(cal.dayHeading('2026-09-25', '2026-09-24'), 'Tomorrow · Friday, Sep 25');
  assert.equal(cal.phoneTimeNote(day[2], 'America/New_York'), '4:00 PM your time');
  assert.equal(cal.phoneTimeNote(day[2], 'America/Chicago'), '');
  assert.equal(cal.phoneTimeNote(day[0], 'America/New_York'), '');
  assert.equal(cal.telHref('(555) 010-0000'), 'tel:5550100000');
  assert.equal(cal.telHref('n/a'), '');
});

function sync(rpc) {
  const calls = [];
  const context = calendar({ console: { info() {} }, client: { rpc: async (name, args) => { calls.push({ name, args: plain(args) }); return rpc(calls.length); } }, Date });
  vm.runInContext(strip(read('calendar-sync.js')), context);
  return { context, calls };
}
const lead = { available: true, leadId: '123', leadName: 'Jane Sample', phones: [{ label: 'Mobile', number: '555-0100' }], callHistory: realLead };

test('the Workspace saves a lead schedule once per change, and keeps working when the table is missing', async () => {
  const ok = sync(() => ({ error: null }));
  assert.equal(await ok.context.saveLeadSchedule(lead), true);
  assert.equal(await ok.context.saveLeadSchedule({ ...lead }), false, 'unchanged: not re-sent');
  assert.equal(ok.calls.length, 1);
  assert.equal(ok.calls[0].name, 'companion_save_schedule');
  assert.equal(ok.calls[0].args.p_replace, true);
  assert.equal(ok.calls[0].args.p_lead.leadKey, 'lead:123');
  assert.equal(ok.calls[0].args.p_events.length, 2);
  assert.equal(await ok.context.saveLeadSchedule({ ...lead, callHistory: ['No Answer on Sep 23 2026 09:38 PM by Me'] }), false, 'nothing scheduled: nothing sent');
  assert.equal(await ok.context.saveLeadSchedule({ available: false }), false);

  const missing = sync(() => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }));
  assert.equal(await missing.context.saveLeadSchedule(lead), false);
  assert.equal(await missing.context.saveLeadSchedule({ ...lead, leadId: '456' }), false);
  assert.equal(missing.calls.length, 1, 'stops trying once it knows the setup is missing');

  const flaky = sync((n) => n === 1 ? { error: { code: '', message: 'Failed to fetch' } } : { error: null });
  assert.equal(await flaky.context.saveLeadSchedule(lead), false);
  assert.equal(await flaky.context.saveLeadSchedule(lead), true, 'network error: retried on the next update');

  const throwing = sync(() => { throw new Error('offline'); });
  assert.equal(await throwing.context.saveLeadSchedule(lead), false, 'never throws');
});

test('an appointment set from the phone is saved without replacing anything', async () => {
  const s = sync(() => ({ error: null }));
  assert.equal(await s.context.saveAppointmentChoice(lead, 'Tomorrow', '11:30 AM'), true);
  assert.equal(s.calls[0].args.p_replace, false);
  assert.equal(s.calls[0].args.p_events[0].source, 'phone');
  assert.equal(await s.context.saveAppointmentChoice(lead, 'Next week', '11:30 AM'), false, 'unclear day: skipped');
  assert.equal(s.calls.length, 1);
});

test('calendar page, links and Workspace hooks are wired', () => {
  const html = read('calendar.html');
  for (const id of ['calendarSetup', 'monthGrid', 'prevMonth', 'nextMonth', 'dayList', 'upcomingList', 'calendarBack']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /Calendar storage isn't set up yet/);
  assert.match(read('index.html'), /<a class="calendarCard" href="calendar\.html\?from=home">/);
  assert.match(read('calendar.js'), /NOT_SET_UP_CODES\.includes\(error\.code\)/);
  const app = read('app.js');
  assert.match(app, /if \(useCloud\) void saveLeadSchedule\(lead\)\.catch\(\(\) => \{\}\);/);
  assert.match(app, /if \(sent && useCloud\) void saveAppointmentChoice\(lead, selectedDay\.label, time\)/);
});
