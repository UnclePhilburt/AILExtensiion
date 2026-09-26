import { client } from './auth-runtime.js';
import { dailyBrief } from './daily-brief.js';
const $ = (selector) => document.querySelector(selector);
const status = $('#dailyStatus');
function metric(value, label) { const item = document.createElement('div'); const number = document.createElement('strong'); const text = document.createElement('span'); number.textContent = value; text.textContent = label; item.append(number, text); return item; }
function render(brief) {
  $('#dailyGreeting').textContent = `${brief.greeting}.`;
  $('#dailyDate').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const story = $('#dailyStory'); story.textContent = brief.story; story.hidden = false;
  $('#dailyMetrics').replaceChildren(metric(brief.calls, 'Calls started'), metric(brief.results, 'Results recorded'), metric(brief.appointments, 'Appointments set'));
  $('#dailyComparison').textContent = brief.comparison;
  $('#dailyReflection').textContent = brief.reflection;
}
async function load() {
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) { location.replace('account.html?next=daily.html'); return; }
    const since = new Date(); since.setDate(since.getDate() - 8); since.setHours(0, 0, 0, 0);
    const { data, error } = await client.from('companion_events').select('event_type,created_at').gte('created_at', since.toISOString()).order('created_at', { ascending: true });
    if (error) throw error;
    render(dailyBrief(data || []));
    status.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch (error) { status.textContent = error.message || 'Could not load your activity.'; }
}
load();
