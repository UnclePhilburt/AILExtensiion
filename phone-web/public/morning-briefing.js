import { client } from './auth-runtime.js';
import { nextBriefingDelay, briefingKey, briefingDue, briefingDates, localDay, scheduleToday, callingRecap, morningMessage } from './morning-briefing-model.js';
import { appointmentTotals, formatApl } from './appointment-outcomes.js';
import { formatCallingNumber, numberHealth } from './calling-numbers-model.js?v=1';
import { readPendingCall } from './pending-call.js';

const route = location.pathname.split('/').pop() || 'index.html';
const supported = ['index.html','workspace.html','calendar.html','daily.html','statistics.html','settings.html','alongside.html','numbers.html'];
if (supported.includes(route)) start();

function start() {
  let user = null, busy = false, generation = 0, dialog = null;
  const memory = new Map();
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./morning-briefing.css', import.meta.url).href; document.head.append(stylesheet);
  const storage = () => { try { return localStorage; } catch { return null; } };
  const seen = id => { try { return storage()?.getItem(briefingKey(id)) || memory.get(id); } catch { return memory.get(id); } };
  const mark = (id, day) => { memory.set(id, day); try { storage()?.setItem(briefingKey(id), day); } catch {} };
  const activeCall = () => {
    const call = readPendingCall(storage(), user?.id, Date.now());
    return Boolean(call && !call.resultSentAt) || Boolean(document.querySelector('#appointmentPicker:not([hidden])'));
  };
  const link = document.createElement('button'); link.type = 'button'; link.className = 'morningBriefingLink';
  link.textContent = '☀ Your daily briefing'; link.hidden = true;
  if (route === 'index.html') (document.querySelector('.homeMain') || document.querySelector('main'))?.append(link);
  link.addEventListener('click', () => void open(true));

  function close() { if (dialog) { dialog.close(); dialog.remove(); dialog = null; } }
  function sessionChanged(session) {
    const next = session?.user || null;
    if (next?.id !== user?.id) { generation++; close(); }
    user = next; link.hidden = !user;
    // Auth callbacks must finish before issuing Supabase queries.
    setTimeout(() => void open(false), 0);
  }
  client.auth.onAuthStateChange((event, session) => {
    if (['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT','USER_UPDATED'].includes(event)) sessionChanged(session);
  });
  const initialGeneration = generation;
  void client.auth.getSession().then(({data}) => {
    if (generation === initialGeneration) sessionChanged(data?.session);
  }).catch(() => {});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void open(false); });
  let morningTimer;
  function armMorning() {
    clearTimeout(morningTimer);
    morningTimer = setTimeout(() => { void open(false); armMorning(); }, nextBriefingDelay());
  }
  armMorning();
  window.addEventListener('pageshow', () => { armMorning(); void open(false); });
  window.addEventListener('focus', () => void open(false));
  window.addEventListener('storage', event => {
    if (user && event.key === briefingKey(user.id) && dialog?.dataset.automatic === 'true') close();
  });

  async function open(manual) {
    if (!user) return;
    if (navigator.locks?.request) {
      await navigator.locks.request(briefingKey(user.id), {ifAvailable:true}, lock => lock ? show(manual) : undefined);
    } else await show(manual);
  }
  async function show(manual) {
    const now = new Date();
    if (!user || busy || dialog || document.hidden) return;
    if (!manual && (!briefingDue(user.id, seen(user.id), now) || activeCall() || document.querySelector('dialog[open]'))) return;
    busy = true;
    const id = user.id, token = generation;
    const { today, tomorrow } = briefingDates(now);
    try {
      const from = new Date(today); from.setDate(from.getDate() - 1);
      const to = new Date(tomorrow); to.setDate(to.getDate() + 1);
      const activeDay = await lastActiveDay(id, today);
      const end = new Date(activeDay || today);
      if (activeDay) end.setDate(end.getDate() + 1);
      const since = new Date(end); since.setDate(since.getDate() - 8);
      const responses = await Promise.allSettled([
        rows('scheduled_events', 'id,kind,starts_at,all_day,lead_name', id, 'starts_at', from, to),
        rows('companion_events', 'id,event_type,created_at', id, 'created_at', since, end),
        rows('appointment_outcomes', 'id,status,apl,referrals,created_at', id, 'created_at', activeDay || today, end)
      ]);
      if (generation !== token || user?.id !== id || document.hidden || localDay(now) !== localDay(new Date())) return;
      if (!manual && (!briefingDue(id, seen(id), new Date()) || activeCall() || document.querySelector('dialog[open]'))) return;
      const ok = n => responses[n].status === 'fulfilled';
      const data = n => ok(n) ? responses[n].value : [];
      const scheduled = scheduleToday(data(0), now), recap = callingRecap(data(1), now, activeDay);
      const totals = appointmentTotals(data(2), activeDay || today);
      dialog = document.createElement('dialog'); dialog.className = 'morningBriefing';
      dialog.dataset.automatic = String(!manual); dialog.setAttribute('aria-labelledby', 'morningHeading');
      const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'morningDismiss';
      dismiss.textContent = '×'; dismiss.setAttribute('aria-label', 'Dismiss daily briefing'); dismiss.addEventListener('click', close);
      dialog.append(dismiss);
      const heading = document.createElement('h2'); heading.id = 'morningHeading';
      heading.tabIndex = -1; heading.autofocus = true;
      heading.textContent = `${now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'}. Here’s your day.`;
      dialog.append(text('p', now.toLocaleDateString([], {weekday:'long', month:'long', day:'numeric'}), 'morningDate'), heading);
      dialog.append(text('p', morningMessage(id, now, ok(1) ? recap.yesterdayCalls : 0, scheduled.length), 'morningStory'));
      dialog.append(text('h3', 'Today’s appointments & callbacks'));
      if (!ok(0)) dialog.append(text('p', 'Your schedule could not be loaded. Check Calendar when your connection is back.'));
      else if (!scheduled.length) dialog.append(text('p', 'Nothing is saved on your calendar for today.'));
      else {
        const appointments = scheduled.filter(event => event.kind !== 'callback').length;
        const callbacks = scheduled.length - appointments;
        dialog.append(text('p', `${appointments} appointment${appointments === 1 ? '' : 's'} · ${callbacks} callback${callbacks === 1 ? '' : 's'} saved for today`));
        const next = scheduled.find(event => !event.all_day && Date.parse(event.starts_at) >= now);
        const list = document.createElement('ul'); list.className = 'morningSchedule';
        for (const event of scheduled) {
          const row = document.createElement('li');
          const time = event.all_day ? 'Time not specified' : new Date(event.starts_at).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
          const kind = event.kind === 'callback' ? 'Callback' : 'Appointment';
          row.append(text('strong', `${time} · ${kind}`), text('span', event.lead_name || 'Saved lead'));
          if (event === next) row.append(text('small', 'Next on your calendar'));
          if (!event.all_day && Date.parse(event.starts_at) < now) row.append(text('small', 'Earlier today · check Calendar for its result'));
          list.append(row);
        }
        dialog.append(list);
      }
      const calendar = document.createElement('a'); calendar.href = 'calendar.html?from=home'; calendar.textContent = 'Open Calendar'; dialog.append(calendar);
      dialog.append(text('h3', activeDay ? `Last active day · ${activeDay.toLocaleDateString([], {weekday:'long', month:'long', day:'numeric', year:'numeric'})}` : 'No previous activity recorded'));
      if (ok(1)) dialog.append(text('p', `${recap.yesterdayCalls} calls started in Companion. ${recap.insight}`));
      else dialog.append(text('p', 'Calling history is unavailable right now. Your progress has not been counted as zero.'));
      if (ok(2)) dialog.append(text('p', `${totals.held} appointments recorded as held · ${formatApl(totals.apl)} APL · ${totals.referrals} referrals recorded${activeDay ? ' that day' : ''}.`));
      else dialog.append(text('p', 'Appointment results could not be loaded.'));
      const worn = await wornCallingNumbers(id);
      if (worn.length) dialog.append(wornNotice(worn));
      dialog.append(text('p', 'Times use your phone’s time zone. This briefing uses saved Companion activity; unsynced activity may be missing.', 'morningNote'));
      const done = document.createElement('button'); done.type = 'button'; done.className = 'morningStart';
      done.textContent = now.getHours() < 12 ? 'Start my day' : 'Continue my day';
      done.addEventListener('click', close); dialog.append(done);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      document.body.append(dialog); dialog.showModal();
      heading.focus({preventScroll:true}); dialog.scrollTop = 0;
      if (briefingDue(id, seen(id), now)) mark(id, localDay(now));
    } catch { close(); } finally {
      busy = false;
      if (generation !== token && user) setTimeout(() => void open(false), 0);
    }
  }
}

async function wornCallingNumbers(userId) {
  if (typeof client.rpc !== 'function' || typeof numberHealth !== 'function') return [];
  try {
    const listed = client.from('calling_numbers').select('id,phone,label,active,archived').eq('user_id', userId);
    const numbers = await (typeof listed.order === 'function' ? listed.order('created_at', { ascending: true }) : listed);
    const stats = await client.rpc('calling_number_stats');
    if (numbers?.error || stats?.error) return [];
    return (numbers.data || []).filter((row) => row && !row.archived).flatMap((row) => {
      const health = numberHealth(stats.data || [], row.id);
      if (health.estimate !== 'wearing') return [];
      return [{
        phone: typeof formatCallingNumber === 'function' ? formatCallingNumber(row.phone) : row.phone,
        label: row.label || 'Calling number',
        active: Boolean(row.active),
        line: `${health.no_answer} no answer · ${health.answered} answered in the last 30 days.`
      }];
    });
  } catch {
    return [];
  }
}

function wornNotice(worn) {
  const box = document.createElement('section');
  box.className = 'morningWorn';
  box.append(text('h3', worn.length === 1 ? 'One number needs the spam lists' : `${worn.length} numbers need the spam lists`));
  box.append(text('p', 'This comes from your own calls, not the phone company. Clear these before you lean on them today.'));
  const list = document.createElement('ul');
  list.className = 'morningSchedule';
  for (const item of worn) {
    const row = document.createElement('li');
    row.append(text('strong', item.active ? `${item.phone} · set for new calls` : item.phone), text('span', item.label), text('small', item.line));
    list.append(row);
  }
  const open = document.createElement('a');
  open.href = 'numbers.html';
  open.textContent = 'Open the spam lists';
  box.append(list, open);
  return box;
}

function text(tag, value, className = '') {
  const element = document.createElement(tag); element.textContent = value; element.className = className; return element;
}
async function lastActiveDay(id, before) {
  const latest = await Promise.all(['companion_events', 'appointment_outcomes'].map(async table => {
    let query = client.from(table).select('created_at').eq('user_id', id).lt('created_at', before.toISOString());
    if (table === 'companion_events') query = query.in('event_type', ['call', 'no-answer', 'virtual-appointment', 'refused-appointment']);
    const {data, error} = await query.order('created_at', {ascending:false}).limit(1).abortSignal(AbortSignal.timeout(12000));
    if (error) throw error;
    return data?.[0]?.created_at;
  }));
  const times = latest.map(value => Date.parse(value)).filter(Number.isFinite);
  if (!times.length) return null;
  const day = new Date(Math.max(...times)); day.setHours(0, 0, 0, 0);
  return day;
}
async function rows(table, fields, id, dateColumn, from, to) {
  const result = [];
  // Read all pages instead of silently treating Supabase's row limit as a full week.
  for (let offset = 0; offset < 20000; offset += 500) {
    const {data, error} = await client.from(table).select(fields).eq('user_id', id)
      .gte(dateColumn, from.toISOString()).lt(dateColumn, to.toISOString())
      .order('id', {ascending:true}).range(offset, offset + 499).abortSignal(AbortSignal.timeout(12000));
    if (error) throw error;
    result.push(...(data || []));
    if (!data || data.length < 500) return result;
  }
  throw new Error('History is too large for a complete briefing.');
}
