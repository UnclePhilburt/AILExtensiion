import { client } from './auth-runtime.js';
import { formatApl } from './appointment-outcomes.js';
import { chartPoints } from './statistics-view.js';
import { loadPhoneSettings } from './settings-store.js';
import { publishAlongsideProfile } from './alongside-profile.js';
import { ALONGSIDE_RANGES, ALONGSIDE_METRICS, alongsideSince, alongsideSentence, heldShare, personFromRow, rhythmBuckets, sortAlongside, tallySelf, metricOf } from './alongside-view.js';

const $ = (selector) => document.querySelector(selector);
const status = $('#alongsideStatus');
const ranges = $('#alongsideRanges');
const metricSelect = $('#alongsideMetric');
let range = 'week';
let metric = 'held';
let people = [];
let events = [];
let outcomes = [];
let shared = false;

for (const [id, label] of ALONGSIDE_RANGES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('role', 'tab');
  button.dataset.range = id;
  button.addEventListener('click', () => { range = id; load(); });
  ranges.append(button);
}
for (const [id, label] of ALONGSIDE_METRICS) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = label;
  metricSelect.append(option);
}
metricSelect.addEventListener('change', () => { metric = metricSelect.value; paint(); });

function markRanges() {
  for (const button of ranges.querySelectorAll('button')) button.setAttribute('aria-selected', String(button.dataset.range === range));
}

function paintRing(person) {
  const share = heldShare(person);
  const ring = $('#heldRing');
  const length = 2 * Math.PI * 46;
  ring.style.strokeDasharray = `${(length * share).toFixed(1)} ${length.toFixed(1)}`;
  $('#heldRate').textContent = person.scheduled ? `${Math.round(share * 100)}%` : '–';
}

function paintRhythm() {
  const buckets = rhythmBuckets(events, outcomes, metric, range);
  const chart = $('#rhythmChart');
  const axis = $('#rhythmAxis');
  const label = ALONGSIDE_METRICS.find(([id]) => id === metric)?.[1] || 'Held';
  $('#rhythmHeading').textContent = `${label}, across ${ALONGSIDE_RANGES.find(([id]) => id === range)?.[1].toLowerCase() || 'the period'}`;
  chart.replaceChildren();
  axis.replaceChildren();
  const plotted = buckets.filter((bucket) => bucket.value !== null);
  chart.setAttribute('aria-label', $('#rhythmHeading').textContent);
  if (!plotted.some((bucket) => bucket.value > 0)) {
    const note = document.createElement('p');
    note.className = 'trendEmpty';
    note.textContent = 'Your line will appear as this period fills in.';
    chart.append(note);
    return;
  }
  const points = chartPoints(plotted.map((bucket) => ({ value: bucket.value })), 320, 150);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 320 150');
  svg.setAttribute('preserveAspectRatio', 'none');
  const visible = points;
  if (visible.length > 1) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', visible.map((point) => `${point.x},${point.y}`).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#3d6b52');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    svg.append(line);
  }
  for (const point of visible) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', point.x);
    dot.setAttribute('cy', point.y);
    dot.setAttribute('r', '3.5');
    dot.setAttribute('fill', '#3d6b52');
    svg.append(dot);
  }
  chart.append(svg);
  const step = Math.max(1, Math.ceil(plotted.length / 6));
  plotted.forEach((bucket, index) => {
    if (index % step && index !== buckets.length - 1) return;
    const tick = document.createElement('span');
    tick.textContent = bucket.label;
    tick.style.left = `${points[index].x / 320 * 100}%`;
    if (points[index].x < 24) tick.className = 'atStart';
    else if (points[index].x > 296) tick.className = 'atEnd';
    axis.append(tick);
  });
}

function paintBoard() {
  const board = $('#alongsideBoard');
  const ranked = sortAlongside(people, metric);
  const top = Math.max(1, ...ranked.map((person) => metricOf(person, metric)));
  const label = ALONGSIDE_METRICS.find(([id]) => id === metric)?.[1] || '';
  $('#boardHeading').textContent = label;
  board.replaceChildren();
  if (!ranked.length) {
    const note = document.createElement('p');
    note.className = 'boardEmpty';
    note.textContent = 'When your team uses Companion, they will sit here beside you.';
    board.append(note);
    return;
  }
  for (const person of ranked) {
    const row = document.createElement('div');
    row.className = `boardRow${person.isSelf ? ' isYou' : ''}`;
    const meta = document.createElement('div');
    meta.className = 'boardMeta';
    const name = document.createElement('strong');
    name.textContent = person.isSelf ? (loadPhoneSettings(localStorage).firstName || 'You') : person.name;
    const value = document.createElement('span');
    const amount = metricOf(person, metric);
    value.textContent = metric === 'apl' ? formatApl(amount) : String(amount);
    meta.append(name, value);
    const track = document.createElement('div');
    track.className = 'boardTrack';
    const fill = document.createElement('div');
    fill.className = 'boardFill';
    fill.style.width = `${Math.round(amount / top * 100)}%`;
    track.append(fill);
    row.append(meta, track);
    board.append(row);
  }
}

function paint() {
  markRanges();
  const you = people.find((person) => person.isSelf) || tallySelf(events, outcomes, loadPhoneSettings(localStorage).firstName || 'You');
  const period = ALONGSIDE_RANGES.find(([id]) => id === range)?.[1] || 'This period';
  $('#heroEyebrow').textContent = period.toUpperCase();
  $('#heroHeading').textContent = range === 'all' ? 'Everything so far' : period;
  $('#heroSentence').textContent = alongsideSentence(you);
  $('#pairSet').textContent = String(you.scheduled);
  $('#pairHeld').textContent = String(you.held);
  paintRing(you);
  paintRhythm();
  paintBoard();
  const others = people.filter((person) => !person.isSelf).length;
  $('#alongsideNote').textContent = shared
    ? `${others ? `${others} teammate${others === 1 ? '' : 's'} beside you. ` : ''}Only totals. No customer names, numbers, or notes.`
    : 'Showing your own numbers. Teammates appear beside you after the shared view is turned on.';
}

async function loadOwn(since) {
  let eventQuery = client.from('companion_events').select('event_type,created_at').order('created_at', { ascending: true }).limit(10000);
  let outcomeQuery = client.from('appointment_outcomes').select('status,apl,referrals,created_at').order('created_at', { ascending: true }).limit(10000);
  if (since) {
    const iso = since.toISOString();
    eventQuery = eventQuery.gte('created_at', iso);
    outcomeQuery = outcomeQuery.gte('created_at', iso);
  }
  const [eventResult, outcomeResult] = await Promise.all([eventQuery, outcomeQuery]);
  if (eventResult.error) throw eventResult.error;
  events = eventResult.data || [];
  outcomes = outcomeResult.error ? [] : (outcomeResult.data || []);
}

async function load() {
  status.textContent = 'Gathering the quiet numbers…';
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) { location.replace('account.html?next=alongside.html'); return; }
    await publishAlongsideProfile();
    const since = alongsideSince(range);
    const board = await client.rpc('alongside_board', { p_since: since ? since.toISOString() : null });
    shared = !board.error;
    if (shared && Array.isArray(board.data) && board.data.length) people = board.data.map(personFromRow);
    await loadOwn(since);
    if (!shared) people = [tallySelf(events, outcomes, loadPhoneSettings(localStorage).firstName || 'You')];
    else if (!people.some((person) => person.isSelf)) people = [tallySelf(events, outcomes, loadPhoneSettings(localStorage).firstName || 'You'), ...people];
    paint();
    status.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch (error) {
    status.textContent = error.message || 'Could not open Alongside.';
  }
}

load();
