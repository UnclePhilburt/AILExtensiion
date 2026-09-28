import { client } from './auth-runtime.js';
import { numberHealth, formatCallingNumber } from './calling-numbers-model.js';
import { startOfToday, todayMetrics, laneStatus, dashboardNote, upcomingEvents } from './today-view.js';

const $ = selector => document.querySelector(selector);
let user = null, channel = null, loading = false, reloadQueued = false;
let latestMetrics = {calls:0,noAnswer:0,appointments:0,refused:0,held:0}, latestUpcoming = [];
const text = (tag, value, className = '') => { const item = document.createElement(tag); item.textContent = value; item.className = className; return item; };
const eventTime = value => new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});

function renderMetrics(metrics) {
  $('#metricCalls').textContent = metrics.calls;
  $('#metricResults').textContent = metrics.noAnswer + metrics.appointments + metrics.refused;
  $('#metricAppointments').textContent = metrics.appointments;
  $('#metricHeld').textContent = metrics.held;
}
function renderLanes(state) {
  const lanes = ['1','2'].map(slot => laneStatus(state, slot));
  const list = $('#todayLanes'); list.replaceChildren();
  for (const lane of lanes) {
    const row = document.createElement('article'); row.className = 'todayLane'; row.dataset.kind = lane.kind;
    const number = text('span', lane.id); number.className = 'laneNumber';
    const copy = document.createElement('div'); copy.append(text('strong', `Phone ${lane.id}`), text('span', lane.lead?.leadName ? `Lead ready: ${lane.lead.leadName}` : lane.label));
    row.append(number, copy); list.append(row);
  }
  const reconnect = lanes.find(lane => lane.kind === 'reconnect');
  const note = $('#recoveryMessage'); note.hidden = !reconnect;
  note.textContent = reconnect ? `Phone ${reconnect.id} disconnected. Its assigned lead is still held for reconnection. Open Companion on that phone and select Phone ${reconnect.id} in Settings.` : '';
  const computer = lanes[0].kind === 'offline' ? 'Computer offline' : reconnect ? 'Needs attention' : lanes.some(lane => lane.kind === 'ready') ? 'Live' : 'Waiting';
  $('#computerStatus').textContent = computer;
  return lanes;
}
function renderUpcoming(rows) {
  const holder = $('#upcomingEvents'); holder.replaceChildren();
  if (!rows.length) { holder.append(text('p', 'Nothing else is saved on the calendar today.')); return; }
  for (const row of rows) {
    const item = document.createElement('article'); item.className = 'eventRow';
    item.append(text('strong', `${eventTime(row.starts_at)} · ${row.kind === 'callback' ? 'Callback' : 'Appointment'}`), text('span', row.lead_name || 'Saved lead'));
    holder.append(item);
  }
}
function renderNumbers(numbers, stats) {
  const holder = $('#numberHealth'); holder.replaceChildren();
  const active = (numbers || []).filter(row => !row.archived).slice(0, 3);
  if (!active.length) { holder.append(text('p', 'Save a calling number when you are ready to track line health.')); return; }
  for (const number of active) {
    const health = numberHealth(stats || [], number.id);
    const row = document.createElement('article'); row.className = 'numberRow';
    const left = document.createElement('div'); left.append(text('strong', formatCallingNumber(number.phone)), text('span', `${health.calls} calls · ${health.noAnswerRate} no-answer`));
    const right = document.createElement('div'); right.append(text('strong', health.appointmentRate), text('span', 'appointment rate'));
    row.append(left,right); holder.append(row);
  }
}
function renderTips(metrics, events) {
  const holder = $('#todayTips'); holder.replaceChildren();
  const recent = [...events].sort((a,b) => Date.parse(b.created_at)-Date.parse(a.created_at))[0];
  const tips = [];
  if (recent) tips.push(`Last activity: ${recent.event_type.replaceAll('-', ' ')} at ${eventTime(recent.created_at)}.`);
  if (metrics.calls && metrics.noAnswer / metrics.calls > .65) tips.push('A high no-answer stretch is normal. Keep a steady pace and let the next conversation be its own moment.');
  else if (metrics.appointments) tips.push('Appointments are now on the calendar. Give the next conversation the same steady attention.');
  else tips.push('Keep the desk simple: read, dial, listen, record, and begin again.');
  holder.append(...tips.map(value => text('p', value, 'tipRow')));
}
async function load() {
  if (!user) return;
  if (loading) { reloadQueued = true; return; }
  loading = true; $('#todayRefresh').disabled = true; $('#todayStatus').textContent = 'Updating…';
  const from = startOfToday(), to = new Date(from); to.setDate(to.getDate() + 1);
  try {
    const [eventsResult, outcomesResult, scheduleResult, stateResult, numbersResult, statsResult] = await Promise.all([
      client.from('companion_events').select('event_type,created_at').gte('created_at',from.toISOString()).order('created_at',{ascending:true}),
      client.from('appointment_outcomes').select('status,created_at').gte('created_at',from.toISOString()),
      client.from('scheduled_events').select('kind,starts_at,all_day,lead_name').gte('starts_at',from.toISOString()).lt('starts_at',to.toISOString()).order('starts_at',{ascending:true}),
      client.from('companion_sync').select('desktop_seen,phone_seen,slot_phone_seen,lead,slot_leads').maybeSingle(),
      client.from('calling_numbers').select('id,phone,label,active,archived').order('created_at',{ascending:true}),
      client.rpc('calling_number_stats')
    ]);
    if (eventsResult.error) throw eventsResult.error;
    const events = eventsResult.data || [], outcomes = outcomesResult.error ? [] : outcomesResult.data || [];
    const metrics = todayMetrics(events, outcomes);
    const upcoming = scheduleResult.error ? [] : upcomingEvents(scheduleResult.data || []);
    latestMetrics = metrics; latestUpcoming = upcoming;
    const lanes = renderLanes(stateResult.error ? null : stateResult.data);
    renderMetrics(metrics); renderUpcoming(upcoming); renderNumbers(numbersResult.error ? [] : numbersResult.data || [], statsResult.error ? [] : statsResult.data || []); renderTips(metrics, events);
    $('#todayNote').textContent = dashboardNote(metrics, lanes, upcoming);
    $('#todayStatus').textContent = `Updated ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
  } catch (error) {
    $('#todayStatus').textContent = error.message || 'Could not update the desk.';
  } finally {
    loading = false; $('#todayRefresh').disabled = false;
    if (reloadQueued) { reloadQueued = false; void load(); }
  }
}
function watch() {
  channel?.unsubscribe?.();
  const refresh = () => void load();
  const syncLane = payload => {
    // A desktop lead write contains the full, new lane state. Paint that state
    // immediately; the following load refreshes the rest of the dashboard.
    if (payload.new) {
      const lanes = renderLanes(payload.new);
      $('#todayNote').textContent = dashboardNote(latestMetrics, lanes, latestUpcoming);
      $('#todayStatus').textContent = 'Live update';
    }
    refresh();
  };
  channel = client.channel(`today-desk-${crypto.randomUUID()}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'companion_sync',filter:`user_id=eq.${user.id}`},syncLane)
    .on('postgres_changes',{event:'*',schema:'public',table:'companion_events',filter:`user_id=eq.${user.id}`},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'appointment_outcomes',filter:`user_id=eq.${user.id}`},refresh)
    .subscribe();
}
$('#todayRefresh').addEventListener('click',()=>void load());
$('#todayDate').textContent = new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'});
client.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null;
  if (!user) { location.replace('account.html?next=today.html'); return; }
  watch(); void load();
});
const {data} = await client.auth.getSession();
if (!data.session) location.replace('account.html?next=today.html');
else { user = data.session.user; watch(); void load(); }
setInterval(()=>void load(),30000);
window.addEventListener('pageshow',()=>void load());
