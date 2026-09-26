import { client } from './auth-runtime.js';
import { IMPACT_TIME_ZONE, wallClockToInstant, zonedParts } from './time-zone.js';
import { displayName, greeting, dateLine, todaySummary } from './home-view.js';
import { loadPhoneSettings } from './settings-store.js';

const $ = (selector) => document.querySelector(selector);
const signedIn = $('#signedIn'); const signedOut = $('#signedOut'); const shortcuts = $('#homeShortcuts');
const account = $('#accountName'); const message = $('#homeStatus');
let name = '';
let todayChecked = false;

function paintGreeting() {
  $('#homeGreeting').textContent = greeting(Date.now(), loadPhoneSettings(localStorage).firstName || name);
  $('#homeDate').textContent = dateLine(Date.now());
}
paintGreeting();
setInterval(paintGreeting, 60000);

client.auth.onAuthStateChange((_event, session) => render(session));
const { data, error } = await client.auth.getSession();
if (error) message.textContent = error.message;
render(data.session);

function render(session) {
  const ready = Boolean(session?.user);
  signedIn.hidden = !ready; signedOut.hidden = ready; shortcuts.hidden = !ready;
  account.textContent = session?.user?.email || '';
  message.textContent = ready ? 'Ready when you are' : 'Sign in once to use your phone workspace.';
  message.dataset.state = ready ? 'ready' : 'signedOut';
  name = ready ? displayName(session.user) : '';
  paintGreeting();
  if (ready && !todayChecked) { todayChecked = true; void showToday(); }
}

// "2 appointments · 1 callback today" on the Calendar shortcut. Reads only this
// account's own rows around today; any problem (table not set up, offline) keeps
// the default caption without a message.
async function showToday() {
  try {
    const p = zonedParts(Date.now(), IMPACT_TIME_ZONE);
    const from = wallClockToInstant(IMPACT_TIME_ZONE, p.year, p.month - 1, p.day - 1);
    const to = wallClockToInstant(IMPACT_TIME_ZONE, p.year, p.month - 1, p.day + 2);
    const { data: rows, error: queryError } = await client.from('scheduled_events')
      .select('id,kind,starts_at,all_day')
      .gte('starts_at', new Date(from).toISOString()).lt('starts_at', new Date(to).toISOString())
      .limit(500);
    if (queryError) return;
    const text = todaySummary(rows);
    if (text) $('#calendarToday').textContent = text;
  } catch (_error) { /* the default caption stays */ }
}
