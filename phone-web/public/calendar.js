// The Calendar page: appointments and callbacks from scheduled_events (see
// calendar-sync.js for how they are saved). Month grid with dots, the selected
// day's list, and the next 14 days. Times in Central, as IMPACT lists them.
import { client } from './auth-runtime.js';
import { localTimeZone } from './time-zone.js';
import { requestTypeLabel } from './lead-rules.js';
import { NOT_SET_UP_CODES } from './calendar-sync.js';
import { appointmentOutcomeInput } from './appointment-outcomes.js';
import {
  EVENT_KINDS, normalizeEvent, groupByDay, monthGrid, shiftMonth, monthLabel, dayHeading, dayKey,
  eventStatus, upcomingEvents, formatEventTime, phoneTimeNote, telHref
} from './calendar-events.js';

const $ = (selector) => document.querySelector(selector);
const status = $('#calendarStatus');
const phoneZone = localTimeZone();
const BACK = { home: ['./', '← Home'], workspace: ['workspace.html', '← Workspace'], 'workspace-local': ['workspace.html?mode=local', '← Workspace'] };
const [backHref, backLabel] = BACK[new URLSearchParams(location.search).get('from')] || BACK.home;
$('#calendarBack').href = backHref;
$('#calendarBack').textContent = backLabel;

let events = [];
let byDay = new Map();
let today = dayKey(Date.now());
let selected = today;
let view = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };
let selectedOutcomeEvent = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function eventItem(event, now) {
  const tone = event.kind === 'callback' ? 'callback' : 'appointment';
  const item = el('article', `calEvent ${tone}${eventStatus(event, now) === 'past' ? ' past' : ''}`);
  const time = el('div', 'calTime');
  time.append(el('strong', '', formatEventTime(event)));
  const note = phoneTimeNote(event, phoneZone);
  if (note) time.append(el('small', '', note));
  const body = el('div', 'calBody');
  body.append(el('span', 'calKind', EVENT_KINDS[event.kind]), el('strong', 'calName', event.leadName));
  if (event.requestType) body.append(el('span', 'calMeta', requestTypeLabel(event.requestType)));
  const href = telHref(event.phone);
  if (href) {
    const call = el('a', 'calPhone', `☎ ${event.phone}`);
    call.href = href;
    body.append(call);
  }
  if (event.address) body.append(el('span', 'calAddress', event.address));
  if (event.outcome?.status === 'rescheduled' && event.outcome.rescheduled_for) body.append(el('span', 'calMeta', `Rescheduled to ${new Date(event.outcome.rescheduled_for).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`));
  if (event.kind !== 'callback') {
    const outcome = el('button', 'appointmentOutcomeButton', event.outcome ? 'Edit appointment result' : 'Add appointment result');
    outcome.type = 'button'; outcome.dataset.outcomeEvent = String(event.id);
    body.append(outcome);
  }
  item.append(time, body);
  return item;
}

function openOutcome(event) {
  selectedOutcomeEvent = event;
  const panel = $('#appointmentOutcome');
  const saved = event.outcome || {};
  $('#outcomeHeading').textContent = event.outcome ? 'Edit appointment result' : 'Appointment result';
  $('#outcomeLead').textContent = `${event.leadName} · ${formatEventTime(event)}`;
  $('#outcomeType').value = saved.status || 'held';
  $('#outcomeApl').value = saved.apl || '';
  $('#outcomeReferrals').value = saved.referrals || '';
  $('#outcomeNotes').value = saved.notes || '';
  const rescheduled = saved.rescheduled_for ? new Date(saved.rescheduled_for) : null;
  $('#outcomeRescheduleDate').value = rescheduled ? `${rescheduled.getFullYear()}-${String(rescheduled.getMonth() + 1).padStart(2, '0')}-${String(rescheduled.getDate()).padStart(2, '0')}` : '';
  $('#outcomeRescheduleTime').value = rescheduled ? `${String(rescheduled.getHours()).padStart(2, '0')}:${String(rescheduled.getMinutes()).padStart(2, '0')}` : '';
  toggleOutcomeFields();
  $('#outcomeStatus').textContent = '';
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleOutcomeFields() {
  const type = $('#outcomeType').value;
  $('#productionFields').hidden = type !== 'held';
  $('#rescheduleFields').hidden = type !== 'rescheduled';
}

async function saveOutcome() {
  if (!selectedOutcomeEvent) return;
  const button = $('#saveOutcome'); button.disabled = true;
  const value = appointmentOutcomeInput({ status: $('#outcomeType').value, apl: $('#outcomeApl').value, referrals: $('#outcomeReferrals').value, notes: $('#outcomeNotes').value, rescheduledFor: `${$('#outcomeRescheduleDate').value}T${$('#outcomeRescheduleTime').value}` });
  if (value.status === 'rescheduled' && !value.rescheduled_for) { $('#outcomeStatus').textContent = 'Choose the new date and time first.'; button.disabled = false; return; }
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData?.session) { location.replace('account.html?next=calendar.html'); return; }
    const row = { user_id: sessionData.session.user.id, scheduled_event_id: selectedOutcomeEvent.id, ...value, updated_at: new Date().toISOString() };
    const { error } = await client.from('appointment_outcomes').upsert(row, { onConflict: 'user_id,scheduled_event_id' });
    if (error) throw error;
    if (value.status === 'rescheduled' && selectedOutcomeEvent.leadKey) {
      const rescheduled = { user_id: sessionData.session.user.id, lead_key: selectedOutcomeEvent.leadKey, impact_lead_id: selectedOutcomeEvent.impactLeadId || null, lead_name: selectedOutcomeEvent.leadName, phone: selectedOutcomeEvent.phone, address: selectedOutcomeEvent.address, request_type: selectedOutcomeEvent.requestType, kind: selectedOutcomeEvent.kind, starts_at: value.rescheduled_for, all_day: false, source: 'phone', source_line: 'Rescheduled from Calendar' };
      const { error: rescheduleError } = await client.from('scheduled_events').upsert(rescheduled, { onConflict: 'user_id,lead_key,kind,starts_at' });
      if (rescheduleError) throw rescheduleError;
    }
    $('#outcomeStatus').textContent = 'Saved. Your statistics and Your Day will include it.';
    await load();
  } catch (error) { $('#outcomeStatus').textContent = error?.message || 'Could not save this appointment result.'; } finally { button.disabled = false; }
}

function renderList(container, list, emptyText, withDays = false) {
  const now = Date.now();
  container.replaceChildren();
  if (!list.length) { container.append(el('p', 'calEmpty', emptyText)); return; }
  let lastDay = '';
  for (const event of list) {
    if (withDays && event.day !== lastDay) { container.append(el('h3', 'calDayLabel', dayHeading(event.day, today))); lastDay = event.day; }
    container.append(eventItem(event, now));
  }
}

function renderMonth() {
  $('#monthLabel').textContent = monthLabel(view.year, view.month);
  const grid = $('#monthGrid');
  grid.replaceChildren();
  for (const week of monthGrid(view.year, view.month, today)) {
    for (const cell of week) {
      const dayEvents = byDay.get(cell.key) || [];
      const button = el('button', `calDay${cell.inMonth ? '' : ' outside'}${cell.isToday ? ' today' : ''}${cell.key === selected ? ' selected' : ''}`);
      button.type = 'button';
      button.dataset.day = cell.key;
      button.setAttribute('aria-pressed', String(cell.key === selected));
      button.setAttribute('aria-label', `${dayHeading(cell.key, today)}${dayEvents.length ? `, ${dayEvents.length} scheduled` : ''}`);
      button.append(el('span', 'calDayNumber', String(cell.day)));
      const dots = el('span', 'calDots');
      for (const tone of ['appointment', 'callback']) {
        if (dayEvents.some((event) => (event.kind === 'callback') === (tone === 'callback'))) dots.append(el('i', `dot ${tone}`));
      }
      button.append(dots);
      grid.append(button);
    }
  }
}

function render() {
  today = dayKey(Date.now());
  byDay = groupByDay(events);
  renderMonth();
  $('#dayHeading').textContent = dayHeading(selected, today);
  renderList($('#dayList'), byDay.get(selected) || [], 'Nothing scheduled this day.');
  renderList($('#upcomingList'), upcomingEvents(events, Date.now()), 'No appointments or callbacks in the next 14 days.', true);
}

function selectDay(key) {
  selected = key;
  const year = Number(key.slice(0, 4)), month = Number(key.slice(5, 7)) - 1;
  if (year !== view.year || month !== view.month) view = { year, month };
  render();
}

$('#monthGrid').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-day]');
  if (button) selectDay(button.dataset.day);
});
$('#prevMonth').addEventListener('click', () => { view = shiftMonth(view.year, view.month, -1); render(); });
$('#nextMonth').addEventListener('click', () => { view = shiftMonth(view.year, view.month, 1); render(); });
$('#todayButton').addEventListener('click', () => selectDay(dayKey(Date.now())));
$('#calendarRefresh').addEventListener('click', () => load());
$('#dayList').addEventListener('click', (event) => { const button = event.target.closest('[data-outcome-event]'); if (button) openOutcome(events.find((item) => String(item.id) === button.dataset.outcomeEvent)); });
$('#upcomingList').addEventListener('click', (event) => { const button = event.target.closest('[data-outcome-event]'); if (button) openOutcome(events.find((item) => String(item.id) === button.dataset.outcomeEvent)); });
$('#saveOutcome').addEventListener('click', saveOutcome);
$('#cancelOutcome').addEventListener('click', () => { selectedOutcomeEvent = null; $('#appointmentOutcome').hidden = true; });
$('#outcomeType').addEventListener('change', toggleOutcomeFields);

async function load() {
  const refresh = $('#calendarRefresh');
  refresh.disabled = true;
  status.textContent = 'Loading your calendar…';
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData?.session) { location.replace('account.html?next=calendar.html'); return; }
    const [{ data, error }, outcomes] = await Promise.all([
      client.from('scheduled_events')
      .select('id,lead_key,impact_lead_id,kind,starts_at,all_day,lead_name,phone,address,request_type,source_line')
      .order('starts_at', { ascending: true }).limit(2000),
      client.from('appointment_outcomes').select('scheduled_event_id,status,apl,referrals,notes,rescheduled_for,created_at').limit(2000)
    ]);
    if (error) {
      if (NOT_SET_UP_CODES.includes(error.code)) {
        $('#calendarSetup').hidden = false;
        status.textContent = 'Calendar storage isn\u2019t set up yet.';
        events = [];
        render();
        return;
      }
      throw error;
    }
    $('#calendarSetup').hidden = true;
    if (outcomes.error && !NOT_SET_UP_CODES.includes(outcomes.error.code)) throw outcomes.error;
    const byEvent = new Map((outcomes.data || []).map((outcome) => [String(outcome.scheduled_event_id), outcome]));
    events = (data || []).map(normalizeEvent).filter(Boolean).map((event) => ({ ...event, outcome: byEvent.get(String(event.id)) || null }));
    render();
    status.textContent = events.length ? `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Nothing scheduled yet. Appointments and callbacks appear here as you work leads.';
  } catch (error) {
    status.textContent = error?.message || 'Could not load your calendar. Try again.';
  } finally {
    refresh.disabled = false;
  }
}

render();
void load();
// Coming back to the page (from the dialer, another app, or the back button).
document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) void load(); });
