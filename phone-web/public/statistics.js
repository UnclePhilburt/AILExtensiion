import { client } from './auth-runtime.js';

const status = document.querySelector('#statsStatus');
const summary = document.querySelector('#statsSummary');
const rows = document.querySelector('#statsRows');
const refresh = document.querySelector('#statsRefresh');
const METRICS = [['call', 'Calls started', '☎'], ['no-answer', 'No answer', '○'], ['virtual-appointment', 'Virtual appointments', '▣'], ['refused-appointment', 'Appointments refused', '×'], ['next', 'Leads moved forward', '→']];
const count = (events, type) => events.filter((event) => event.event_type === type).length;
function tile(value, label) { const box = document.createElement('div'); const number = document.createElement('strong'); const caption = document.createElement('span'); number.textContent = String(value); caption.textContent = label; box.append(number, caption); return box; }
function render(events) {
  const calls = count(events, 'call'); const results = count(events, 'no-answer') + count(events, 'virtual-appointment') + count(events, 'refused-appointment');
  summary.replaceChildren(tile(calls, 'Calls started'), tile(results, 'Call results'), tile(count(events, 'next'), 'Leads moved'));
  rows.replaceChildren();
  for (const [type, label, icon] of METRICS) { const row = document.createElement('div'); row.className = 'statsRow'; const labelWrap = document.createElement('span'); labelWrap.className = 'statsLabel'; const iconEl = document.createElement('i'); const text = document.createElement('span'); const value = document.createElement('strong'); iconEl.textContent = icon; text.textContent = label; value.textContent = String(count(events, type)); labelWrap.append(iconEl, text); row.append(labelWrap, value); rows.append(row); }
  summary.hidden = false;
}
async function load() {
  refresh.disabled = true; status.textContent = 'Loading your activity…';
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) { location.replace('account.html?next=statistics.html'); return; }
    const since = new Date(); since.setDate(since.getDate() - 6); since.setHours(0, 0, 0, 0);
    const { data, error } = await client.from('companion_events').select('event_type,created_at').gte('created_at', since.toISOString()).order('created_at', { ascending: false });
    if (error) throw error;
    render(data || []); status.textContent = data?.length ? `Updated ${new Date().toLocaleTimeString()}` : 'No Companion activity in the last 7 days yet.';
  } catch (error) { status.textContent = error.message || 'Could not load statistics.'; } finally { refresh.disabled = false; }
}
refresh.addEventListener('click', load); load();
