import { client } from './auth-runtime.js';
import { dailyBrief } from './daily-brief.js';
import { appointmentTotals, formatApl } from './appointment-outcomes.js';
const $ = (selector) => document.querySelector(selector);
const status = $('#dailyStatus');
function metric(value, label) { const item = document.createElement('div'); const number = document.createElement('strong'); const text = document.createElement('span'); number.textContent = value; text.textContent = label; item.append(number, text); return item; }
function render(brief) {
  $('#dailyGreeting').textContent = `${brief.greeting}.`;
  $('#dailyDate').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const story = $('#dailyStory'); story.replaceChildren();
  for (const chapter of brief.chapters || [brief.story]) { const paragraph = document.createElement('p'); paragraph.textContent = chapter; story.append(paragraph); }
  story.hidden = false;
  $('#dailyMetrics').replaceChildren(metric(brief.calls, 'Calls started'), metric(brief.results, 'Results recorded'), metric(brief.appointments, 'Appointments set'));
  $('#dailyComparison').textContent = brief.comparison;
  $('#dailyReflection').textContent = brief.reflection;
}
function renderAppointmentResults(outcomes) {
  const totals = appointmentTotals(outcomes); const section = $('#dailyAppointmentResults');
  section.hidden = !(totals.held || totals.noShow || totals.rescheduled || totals.apl || totals.referrals);
  if (!section.hidden) $('#dailyAppointmentMetrics').replaceChildren(metric(totals.held, 'Held'), metric(totals.noShow, 'No shows'), metric(totals.rescheduled, 'Rescheduled'), metric(formatApl(totals.apl), 'APL'), metric(totals.referrals, 'Referrals'));
}
async function load() {
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) { location.replace('account.html?next=daily.html'); return; }
    const since = new Date(); since.setDate(since.getDate() - 8); since.setHours(0, 0, 0, 0);
    const [{ data, error }, outcomeResponse] = await Promise.all([client.from('companion_events').select('event_type,created_at').gte('created_at', since.toISOString()).order('created_at', { ascending: true }), client.from('appointment_outcomes').select('status,apl,referrals,created_at').gte('created_at', since.toISOString())]);
    if (error) throw error;
    render(dailyBrief(data || []));
    if (!outcomeResponse.error) renderAppointmentResults(outcomeResponse.data || []);
    status.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch (error) { status.textContent = error.message || 'Could not load your activity.'; }
}
load();
