// Pure date-range and trend helpers for Statistics. Dates intentionally use the
// phone's calendar because the page describes the rep's own working day.
export const RANGE_OPTIONS = [
  ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['ytd', 'Year to date'], ['year', 'This year'], ['all', 'All time']
];
const pad = (value) => String(value).padStart(2, '0');
export const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export function rangeStart(range, now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (range === 'today') return start;
  if (range === 'week') { start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); return start; }
  if (range === 'month') { start.setDate(1); return start; }
  if (range === 'ytd' || range === 'year') { start.setMonth(0, 1); return start; }
  return new Date(0);
}
export function metricRows(events, outcomes) {
  const count = (type) => events.filter((event) => event.event_type === type).length;
  const appointment = (status) => outcomes.filter((row) => row.status === status).length;
  return { calls: count('call'), results: count('no-answer') + count('virtual-appointment') + count('refused-appointment'), appointments: appointment('held'), noShow: appointment('no-show'), rescheduled: appointment('rescheduled'), apl: outcomes.reduce((sum, row) => sum + Number(row.apl || 0), 0), referrals: outcomes.reduce((sum, row) => sum + Number(row.referrals || 0), 0) };
}
export function dailyTrend(events, outcomes, metric) {
  const days = new Map();
  const put = (at, value) => { const key = dateKey(new Date(at)); days.set(key, (days.get(key) || 0) + value); };
  if (metric === 'calls') for (const event of events) if (event.event_type === 'call') put(event.created_at, 1);
  if (metric === 'results') for (const event of events) if (['no-answer', 'virtual-appointment', 'refused-appointment'].includes(event.event_type)) put(event.created_at, 1);
  if (metric === 'appointments') for (const row of outcomes) if (row.status === 'held') put(row.created_at, 1);
  if (metric === 'apl') for (const row of outcomes) put(row.created_at, Number(row.apl || 0));
  if (metric === 'referrals') for (const row of outcomes) put(row.created_at, Number(row.referrals || 0));
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, value }));
}
export function chartPoints(points, width = 320, height = 150, padX = 16, padY = 16, maxValue = null) {
  if (!points.length) return []; const max = Math.max(maxValue || 0, ...points.map((point) => point.value), 1); const span = Math.max(points.length - 1, 1);
  return points.map((point, index) => ({ ...point, x: padX + index * (width - padX * 2) / span, y: height - padY - (point.value / max) * (height - padY * 2) }));
}
function shiftPeriod(date, range, amount) { const value = new Date(date); if (range === 'today') value.setDate(value.getDate() + amount); else if (range === 'week') value.setDate(value.getDate() + amount * 7); else if (range === 'month') value.setMonth(value.getMonth() + amount); else value.setFullYear(value.getFullYear() + amount); return value; }
export function comparisonWindows(range, mode, now = new Date()) {
  const current = { start: rangeStart(range, now), end: new Date(now), label: RANGE_OPTIONS.find(([id]) => id === range)?.[1] || 'Current period' };
  if (range === 'all' || mode === 'none') return { current, comparisons: [] };
  const duration = current.end.getTime() - current.start.getTime(); const make = (start, label) => ({ start, end: new Date(start.getTime() + duration), label });
  if (mode === 'previous') return { current, comparisons: [make(shiftPeriod(current.start, range, -1), 'Previous matching period')] };
  if (mode === 'four-back') return { current, comparisons: [make(shiftPeriod(current.start, range, -4), `${range === 'week' ? 'Four weeks' : 'Four periods'} ago`)] };
  return { current, comparisons: [1, 2, 3, 4].map((offset) => make(shiftPeriod(current.start, range, -offset), `Previous ${offset}`)) };
}
export function seriesForWindow(events, outcomes, metric, window) { const inWindow = (row) => { const at = new Date(row.created_at); return at >= window.start && at <= window.end; }; const values = new Map(dailyTrend(events.filter(inWindow), outcomes.filter(inWindow), metric).map((item) => [item.day, item.value])); const points = []; const cursor = new Date(window.start); cursor.setHours(0, 0, 0, 0); const final = new Date(window.end); final.setHours(0, 0, 0, 0); while (cursor <= final) { const day = dateKey(cursor); points.push({ day, value: values.get(day) || 0 }); cursor.setDate(cursor.getDate() + 1); } return points; }
export function comparisonTrend(events, outcomes, metric, range, mode, now = new Date()) { const windows = comparisonWindows(range, mode, now); const current = seriesForWindow(events, outcomes, metric, windows.current); if (!windows.comparisons.length) return { current, comparison: [], label: '' }; const all = windows.comparisons.map((window) => seriesForWindow(events, outcomes, metric, window)); const comparison = mode === 'average' ? current.map((_, index) => ({ day: current[index].day, value: all.reduce((sum, series) => sum + (series[index]?.value || 0), 0) / all.length })) : all[0]; return { current, comparison, label: mode === 'average' ? 'Average of previous four periods' : windows.comparisons[0].label }; }
