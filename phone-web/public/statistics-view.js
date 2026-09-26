// Pure date-range and trend helpers for Statistics. Dates intentionally use the
// phone's calendar and clock (Central for the team; no time-zone conversion)
// because the page describes the rep's own working day.
//
// Ranges: Daily (today, per clock hour), Weekly (Mon-Sun, per day), Monthly
// (day 1 to the last day, per day) and Yearly (Jan-Dec, per month). A
// comparison is the previous matching period, lined up by hour of day,
// weekday, day of month or month.

// [id, picker label, period label]
export const RANGE_OPTIONS = [['today', 'Daily', 'Today'], ['week', 'Weekly', 'This week'], ['month', 'Monthly', 'This month'], ['year', 'Yearly', 'This year']];
export const COMPARE_OPTIONS = [['none', 'No comparison'], ['previous', 'Previous matching period']];

// Older links or saved values ('ytd', 'all', ...) fall back to a range that exists.
export function normalizeRange(value) {
  if (RANGE_OPTIONS.some(([id]) => id === value)) return value;
  return value === 'ytd' || value === 'all' ? 'year' : 'today';
}
export const periodLabel = (range) => RANGE_OPTIONS.find(([id]) => id === range)?.[2] || 'Today';

const pad = (value) => String(value).padStart(2, '0');
export const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function rangeStart(range, now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (range === 'week') { start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); return start; }
  if (range === 'month') { start.setDate(1); return start; }
  if (range === 'year' || range === 'ytd') { start.setMonth(0, 1); return start; }
  return start; // today
}
// Start of the period after the one starting at `start`.
function nextPeriod(start, range, amount = 1) {
  const value = new Date(start);
  if (range === 'week') value.setDate(value.getDate() + 7 * amount);
  else if (range === 'month') value.setMonth(value.getMonth() + amount, 1);
  else if (range === 'year') value.setFullYear(value.getFullYear() + amount, 0, 1);
  else value.setDate(value.getDate() + amount);
  return value;
}

export function metricRows(events, outcomes) {
  const count = (type) => events.filter((event) => event.event_type === type).length;
  const appointment = (status) => outcomes.filter((row) => row.status === status).length;
  return { calls: count('call'), results: count('no-answer') + count('virtual-appointment') + count('refused-appointment'), appointments: appointment('held'), noShow: appointment('no-show'), rescheduled: appointment('rescheduled'), apl: outcomes.reduce((sum, row) => sum + Number(row.apl || 0), 0), referrals: outcomes.reduce((sum, row) => sum + Number(row.referrals || 0), 0) };
}

// The rows that count toward a metric, as { at, value }.
export function metricEntries(events, outcomes, metric) {
  const out = [];
  const put = (at, value) => out.push({ at: new Date(at), value });
  if (metric === 'calls') for (const event of events) if (event.event_type === 'call') put(event.created_at, 1);
  if (metric === 'results') for (const event of events) if (['no-answer', 'virtual-appointment', 'refused-appointment'].includes(event.event_type)) put(event.created_at, 1);
  if (metric === 'appointments') for (const row of outcomes) if (row.status === 'held') put(row.created_at, 1);
  if (metric === 'apl') for (const row of outcomes) put(row.created_at, Number(row.apl || 0));
  if (metric === 'referrals') for (const row of outcomes) put(row.created_at, Number(row.referrals || 0));
  return out;
}
export function dailyTrend(events, outcomes, metric) {
  const days = new Map();
  for (const { at, value } of metricEntries(events, outcomes, metric)) { const key = dateKey(at); days.set(key, (days.get(key) || 0) + value); }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, value }));
}

// x across the whole axis (axisLength slots, so future slots keep their place);
// y is null for a point that is not plotted (a day that has not happened yet,
// or a day last month did not have).
export function chartPoints(points, width = 320, height = 150, padX = 16, padY = 16, maxValue = null, axisLength = points.length) {
  if (!points.length) return [];
  const values = points.map((point) => point.value).filter((value) => value !== null && value !== undefined);
  const max = Math.max(maxValue || 0, ...values, 1); const span = Math.max(axisLength - 1, 1);
  const x = (index) => (axisLength === 1 ? width / 2 : padX + index * (width - padX * 2) / span);
  return points.map((point, index) => ({ ...point, x: x(index), y: point.value === null || point.value === undefined ? null : height - padY - (point.value / max) * (height - padY * 2) }));
}

// The current period so far and the previous matching period (whole, so its
// last activity counts toward the axis even if it came later than now).
export function comparisonWindows(range, mode, now = new Date()) {
  const start = rangeStart(range, now);
  const current = { start, end: new Date(now), label: periodLabel(range) };
  if (mode !== 'previous') return { current, comparisons: [] };
  const previousStart = nextPeriod(start, range, -1);
  const label = { today: 'Yesterday', week: 'Last week', month: 'Last month', year: 'Last year' }[range] || 'Previous period';
  return { current, comparisons: [{ start: previousStart, end: new Date(start.getTime() - 1), label }] };
}

const within = (window) => (row) => { const at = new Date(row.created_at); return at >= window.start && at <= window.end; };

// Slot of a moment on the range's axis: hour, weekday (Mon = 0), day of month - 1, or month.
function slotOf(range, at) {
  if (range === 'week') return (at.getDay() + 6) % 7;
  if (range === 'month') return at.getDate() - 1;
  if (range === 'year') return at.getMonth();
  return at.getHours();
}
function buckets(events, outcomes, metric, range, window) {
  const totals = new Map();
  for (const { at, value } of metricEntries(events.filter(within(window)), outcomes.filter(within(window)), metric)) totals.set(slotOf(range, at), (totals.get(slotOf(range, at)) || 0) + value);
  return totals;
}
const daysInMonth = (start) => new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();

export function hourLabel(hour) {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

// Hours with ticks: every 1, 2, 3, 4, 6 or 12 hours, at most maxTicks.
export function hourTicks(hours, maxTicks = 5) {
  if (!hours.length) return [];
  const step = [1, 2, 3, 4, 6, 12].find((size) => hours.filter((hour) => hour % size === 0).length <= maxTicks) || 12;
  const ticks = hours.filter((hour) => hour % step === 0);
  return ticks.length ? ticks : [hours[0]];
}

// Indices of the axis slots that get a label, never more than maxTicks
// (the phone passes 4 on a narrow screen).
export function axisTicks(series, maxTicks = 5) {
  const length = series.axis?.length || 0;
  if (!length) return [];
  if (series.unit === 'hour') return hourTicks(series.hours, maxTicks).map((hour) => series.hours.indexOf(hour));
  if (series.unit === 'weekday') return series.axis.map((_, index) => index); // Mon ... Sun all fit
  if (series.unit === 'month') return series.axis.map((_, index) => index).filter((index) => index % (maxTicks >= 6 ? 2 : 3) === 0);
  // Days of the month: 1, 8, 15, 22, 29 (or fewer).
  const step = maxTicks >= 5 ? 7 : 10;
  return series.axis.map((_, index) => index).filter((index) => index % step === 0);
}

// Daily: per clock hour from the first to the last activity (calls, results,
// moves, outcomes) of today or the comparison day, whichever runs longer.
function hourlyTrend(events, outcomes, metric, windows) {
  const days = [windows.current, ...windows.comparisons];
  const totals = days.map((window) => buckets(events, outcomes, metric, 'today', window));
  const label = windows.comparisons[0]?.label || '';
  const activeHours = days.flatMap((window) => [...events, ...outcomes].filter(within(window)).map((row) => new Date(row.created_at).getHours()));
  const hasData = totals.some((total) => total.size > 0);
  if (!activeHours.length || !hasData) return { unit: 'hour', axis: [], hours: [], current: [], comparison: [], label, hasData: false };
  let first = Math.min(...activeHours); let last = Math.max(...activeHours);
  // One hour alone would be a single dot: show the hour either side too.
  if (first === last) { first = Math.max(0, first - 1); last = Math.min(23, last + 1); }
  const hours = []; for (let hour = first; hour <= last; hour += 1) hours.push(hour);
  const series = (total) => hours.map((hour) => ({ key: hour, label: hourLabel(hour), value: total.get(hour) || 0 }));
  return { unit: 'hour', axis: hours.map(hourLabel), hours, first, last, current: series(totals[0]), comparison: totals[1] ? series(totals[1]) : [], label, hasData };
}

// Weekly / Monthly / Yearly: a fixed axis for the whole period. The current
// line stops at today (later slots are on the axis but not plotted); the
// comparison has a value for every slot its period had.
export function comparisonTrend(events, outcomes, metric, range, mode, now = new Date()) {
  range = normalizeRange(range);
  const windows = comparisonWindows(range, mode, now);
  if (range === 'today') return hourlyTrend(events, outcomes, metric, windows);
  const start = windows.current.start;
  const unit = { week: 'weekday', month: 'day', year: 'month' }[range];
  const length = range === 'week' ? 7 : range === 'month' ? daysInMonth(start) : 12;
  const axis = Array.from({ length }, (_, index) => (range === 'week' ? WEEKDAYS[index] : range === 'year' ? MONTHS[index] : String(index + 1)));
  const slotStart = (periodStart, index) => (range === 'year' ? new Date(periodStart.getFullYear(), index, 1) : new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate() + index));
  const currentTotals = buckets(events, outcomes, metric, range, windows.current);
  const current = axis.map((label, index) => ({ key: index, label, value: slotStart(start, index) <= now ? currentTotals.get(index) || 0 : null }));
  const previous = windows.comparisons[0];
  let comparison = [];
  if (previous) {
    const totals = buckets(events, outcomes, metric, range, previous);
    const previousLength = range === 'month' ? daysInMonth(previous.start) : length;
    comparison = axis.map((label, index) => ({ key: index, label, value: index < previousLength ? totals.get(index) || 0 : null }));
  }
  const hasData = [windows.current, ...windows.comparisons].some((window) => metricEntries(events.filter(within(window)), outcomes.filter(within(window)), metric).length > 0);
  return { unit, axis, current, comparison, label: previous?.label || '', hasData };
}
