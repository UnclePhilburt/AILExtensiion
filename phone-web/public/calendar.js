// The Calendar page: appointments and callbacks from scheduled_events (see
// calendar-sync.js for how they are saved). Month grid with dots, the selected
// day's list, and the next 14 days. Times in Central, as IMPACT lists them.
import { client } from './auth-runtime.js';
import { localTimeZone } from './time-zone.js';
import { NOT_SET_UP_CODES } from './calendar-sync.js';
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
  if (event.requestType) body.append(el('span', 'calMeta', event.requestType));
  const href = telHref(event.phone);
  if (href) {
    const call = el('a', 'calPhone', `☎ ${event.phone}`);
    call.href = href;
    body.append(call);
  }
  if (event.address) body.append(el('span', 'calAddress', event.address));
  item.append(time, body);
  return item;
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

async function load() {
  const refresh = $('#calendarRefresh');
  refresh.disabled = true;
  status.textContent = 'Loading your calendar…';
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData?.session) { location.replace('account.html?next=calendar.html'); return; }
    const { data, error } = await client.from('scheduled_events')
      .select('id,kind,starts_at,all_day,lead_name,phone,address,request_type,source_line')
      .order('starts_at', { ascending: true }).limit(2000);
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
    events = (data || []).map(normalizeEvent).filter(Boolean);
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
