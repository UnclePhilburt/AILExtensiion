const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const vm = require('node:vm'); const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../phone-web/public/statistics-view.js'), 'utf8').replace(/^export /gm, '');
const api = vm.createContext({ Date, String, Number, Math, Map, Array });
vm.runInContext(`${src}; Object.assign(this, { rangeStart, metricRows, dailyTrend, chartPoints, comparisonWindows, comparisonTrend, axisTicks, hourTicks, hourLabel, normalizeRange, periodLabel, RANGE_OPTIONS, COMPARE_OPTIONS });`, api);
const plain = (value) => JSON.parse(JSON.stringify(value));
// All times are the phone's local clock (no Z): Friday 25 Sep 2026, 3 PM.
const NOW = new Date('2026-09-25T15:00:00');
const call = (at) => ({ event_type: 'call', created_at: at });
const values = (series) => plain(series.map((point) => point.value));

test('statistics ranges begin on the right local day', () => { assert.equal(api.rangeStart('today', NOW).getHours(), 0); assert.equal(api.rangeStart('month', NOW).getDate(), 1); assert.equal(api.rangeStart('year', NOW).getMonth(), 0); assert.equal(api.rangeStart('week', NOW).getDay(), 1, 'weeks start on Monday'); });
test('trend groups daily calls, appointments, APL and referrals', () => { const events = [{event_type:'call',created_at:'2026-09-24T10:00:00'}, {event_type:'call',created_at:'2026-09-25T10:00:00'}]; const outcomes = [{status:'held',apl:1200,referrals:2,created_at:'2026-09-25T12:00:00'}]; assert.deepEqual(plain(api.dailyTrend(events,outcomes,'calls')), [{day:'2026-09-24',value:1},{day:'2026-09-25',value:1}]); assert.deepEqual(plain(api.dailyTrend(events,outcomes,'apl')), [{day:'2026-09-25',value:1200}]); assert.equal(api.metricRows(events,outcomes).referrals, 2); assert.equal(api.chartPoints([{day:'a',value:4}])[0].y, 16); });

test('ranges are Daily, Weekly, Monthly, Yearly; compare offers only none or the previous matching period', () => {
  assert.deepEqual(plain(api.RANGE_OPTIONS.map(([id, text]) => [id, text])), [['today', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']]);
  assert.deepEqual(plain(api.COMPARE_OPTIONS.map(([id]) => id)), ['none', 'previous']);
  for (const [old, now] of [['ytd', 'year'], ['all', 'year'], ['four-back', 'today'], [null, 'today'], ['week', 'week']]) assert.equal(api.normalizeRange(old), now, String(old));
  assert.deepEqual(['today', 'week', 'month', 'year'].map((range) => api.comparisonWindows(range, 'previous', NOW).comparisons[0].label), ['Yesterday', 'Last week', 'Last month', 'Last year']);
  assert.equal(api.comparisonWindows('week', 'four-back', NOW).comparisons.length, 0, 'the four-period options are gone');
  const html = fs.readFileSync(path.join(__dirname, '../phone-web/public/statistics.html'), 'utf8');
  assert.doesNotMatch(html, /ytd|All time|four-back|average/);
  assert.match(html, /<option value="today">Daily<\/option><option value="week">Weekly<\/option><option value="month">Monthly<\/option><option value="year">Yearly<\/option>/);
});

test('Daily: calls per clock hour with 0 for quiet hours in between', () => {
  const events = [call('2026-09-25T09:05:00'), call('2026-09-25T09:40:00'), call('2026-09-25T12:10:00'), call('2026-09-25T12:20:00'), call('2026-09-25T12:59:00'), { event_type: 'next', created_at: '2026-09-25T10:30:00' }];
  const trend = api.comparisonTrend(events, [], 'calls', 'today', 'none', NOW);
  assert.equal(trend.unit, 'hour');
  assert.deepEqual(plain(trend.hours), [9, 10, 11, 12]);
  assert.deepEqual(values(trend.current), [2, 0, 0, 3]);
  assert.deepEqual(plain(trend.axis), ['9 AM', '10 AM', '11 AM', '12 PM']);
  assert.deepEqual(plain(trend.comparison), []);
  // Every metric the selector offers works per hour.
  const outcomes = [{ status: 'held', apl: 900, referrals: 3, created_at: '2026-09-25T11:15:00' }, { status: 'no-show', apl: 0, referrals: 0, created_at: '2026-09-25T11:45:00' }];
  const results = [{ event_type: 'no-answer', created_at: '2026-09-25T09:10:00' }, { event_type: 'refused-appointment', created_at: '2026-09-25T12:30:00' }, { event_type: 'virtual-appointment', created_at: '2026-09-25T12:31:00' }];
  const all = [...events, ...results];
  assert.deepEqual(values(api.comparisonTrend(all, outcomes, 'results', 'today', 'none', NOW).current), [1, 0, 0, 2]);
  assert.deepEqual(values(api.comparisonTrend(all, outcomes, 'appointments', 'today', 'none', NOW).current), [0, 0, 1, 0]);
  assert.deepEqual(values(api.comparisonTrend(all, outcomes, 'apl', 'today', 'none', NOW).current), [0, 0, 900, 0]);
  assert.deepEqual(values(api.comparisonTrend(all, outcomes, 'referrals', 'today', 'none', NOW).current), [0, 0, 3, 0]);
});

test('Daily comparison: the axis runs from the earliest to the latest activity of either day, lined up by clock hour', () => {
  // Today 9 AM-2 PM; yesterday started earlier (7 AM) and, as a whole day,
  // also finished later (6 PM, after the current time of day).
  const events = [call('2026-09-25T09:30:00'), call('2026-09-25T14:05:00'), call('2026-09-25T14:25:00'), call('2026-09-24T07:15:00'), call('2026-09-24T09:50:00'), call('2026-09-24T18:40:00')];
  const trend = api.comparisonTrend(events, [], 'calls', 'today', 'previous', NOW);
  assert.equal(trend.first, 7); assert.equal(trend.last, 18);
  assert.deepEqual(plain(trend.hours), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual(values(trend.current), [0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0]);
  assert.deepEqual(values(trend.comparison), [1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(trend.label, 'Yesterday');
  // Each day longer on a different end: today runs later, yesterday earlier.
  const other = api.comparisonTrend([call('2026-09-25T10:00:00'), call('2026-09-25T14:59:00'), call('2026-09-24T08:00:00'), call('2026-09-24T11:00:00')], [], 'calls', 'today', 'previous', NOW);
  assert.deepEqual([other.first, other.last], [8, 14]);
  assert.equal(other.current.length, other.comparison.length, 'same hour axis');
  assert.equal(other.current[other.hours.indexOf(10)].value, 1);
  assert.equal(other.comparison[other.hours.indexOf(8)].value, 1);
  // Two days ago does not count toward yesterday.
  assert.deepEqual(plain(api.comparisonTrend([call('2026-09-25T10:00:00'), call('2026-09-23T06:00:00')], [], 'calls', 'today', 'previous', NOW).hours), [9, 10, 11]);
});

test('Daily: one busy hour is padded by an hour either side; no activity means an empty chart', () => {
  const one = api.comparisonTrend([call('2026-09-25T10:05:00'), call('2026-09-25T10:45:00')], [], 'calls', 'today', 'none', NOW);
  assert.deepEqual(plain(one.hours), [9, 10, 11]);
  assert.deepEqual(values(one.current), [0, 2, 0]);
  assert.deepEqual(plain(api.comparisonTrend([call('2026-09-25T00:10:00')], [], 'calls', 'today', 'none', NOW).hours), [0, 1], 'never before midnight');
  const empty = api.comparisonTrend([], [], 'calls', 'today', 'previous', NOW);
  assert.equal(empty.hasData, false); assert.deepEqual(plain(empty.current), []); assert.deepEqual(plain(empty.comparison), []);
  // Activity, but none of this metric: still the calm empty state.
  assert.equal(api.comparisonTrend([{ event_type: 'next', created_at: '2026-09-25T10:00:00' }], [], 'calls', 'today', 'none', NOW).hasData, false);
  // Only yesterday had calls: today's line is 0 across yesterday's hours.
  const onlyYesterday = api.comparisonTrend([call('2026-09-24T10:00:00')], [], 'calls', 'today', 'previous', NOW);
  assert.equal(onlyYesterday.hasData, true); assert.deepEqual(values(onlyYesterday.current), [0, 0, 0]);
});

test('Weekly: Monday to Sunday, days still to come are on the axis but not plotted; last week lines up by weekday', () => {
  const events = [call('2026-09-21T10:00:00'), call('2026-09-21T11:00:00'), call('2026-09-23T10:00:00'), call('2026-09-25T10:00:00'), call('2026-09-15T10:00:00'), call('2026-09-20T10:00:00'), call('2026-09-13T10:00:00')];
  const trend = api.comparisonTrend(events, [], 'calls', 'week', 'previous', NOW);
  assert.equal(trend.unit, 'weekday');
  assert.deepEqual(plain(trend.axis), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(values(trend.current), [2, 0, 1, 0, 1, null, null]);
  assert.deepEqual(values(trend.comparison), [0, 1, 0, 0, 0, 0, 1], 'last Tuesday and last Sunday');
  assert.equal(trend.label, 'Last week');
  assert.deepEqual(plain(api.axisTicks(trend, 4)), [0, 1, 2, 3, 4, 5, 6], 'Mon ... Sun');
  assert.deepEqual(values(api.comparisonTrend([], [], 'calls', 'week', 'none', NOW).current), [0, 0, 0, 0, 0, null, null]);
});

test('Monthly: day 1 to the last day; a shorter last month leaves its missing days out', () => {
  const trend = api.comparisonTrend([call('2026-09-01T10:00:00'), call('2026-09-25T10:00:00'), call('2026-08-01T10:00:00'), call('2026-08-31T10:00:00')], [], 'calls', 'month', 'previous', NOW);
  assert.equal(trend.axis.length, 30); assert.equal(trend.axis[0], '1'); assert.equal(trend.axis[29], '30');
  assert.equal(trend.current[0].value, 1); assert.equal(trend.current[24].value, 1); assert.equal(trend.current[25].value, null, 'the 26th has not happened');
  assert.equal(trend.comparison[0].value, 1); assert.equal(trend.comparison.length, 30);
  assert.deepEqual(plain(api.axisTicks(trend, 5)), [0, 7, 14, 21, 28], '1, 8, 15, 22, 29');
  const march = api.comparisonTrend([call('2026-02-28T10:00:00'), call('2026-03-31T09:00:00')], [], 'calls', 'month', 'previous', new Date('2026-03-31T12:00:00'));
  assert.equal(march.axis.length, 31);
  assert.deepEqual(values(march.comparison).slice(26), [0, 1, null, null, null], 'February has no 29th-31st');
  assert.equal(march.current[30].value, 1);
});

test('Yearly: January to December per month, lined up by month', () => {
  const trend = api.comparisonTrend([call('2026-01-15T10:00:00'), call('2026-09-02T10:00:00'), call('2026-09-20T10:00:00'), call('2025-12-24T10:00:00'), call('2025-03-01T10:00:00')], [], 'calls', 'year', 'previous', NOW);
  assert.equal(trend.unit, 'month');
  assert.deepEqual(plain(trend.axis), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  assert.deepEqual(values(trend.current), [1, 0, 0, 0, 0, 0, 0, 0, 2, null, null, null]);
  assert.deepEqual(values(trend.comparison), [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(trend.label, 'Last year');
  assert.deepEqual(plain(api.axisTicks(trend, 5)), [0, 3, 6, 9], 'Jan, Apr, Jul, Oct');
});

test('hour ticks read like a clock and never crowd a phone', () => {
  assert.deepEqual(['0', '9', '12', '15', '23'].map((hour) => api.hourLabel(Number(hour))), ['12 AM', '9 AM', '12 PM', '3 PM', '11 PM']);
  const hours = Array.from({ length: 12 }, (_, index) => 7 + index); // 7 AM-6 PM
  const ticks = api.hourTicks(hours, 5);
  assert.ok(ticks.length <= 5); assert.deepEqual(plain(ticks), [9, 12, 15, 18]);
  assert.ok(api.hourTicks(hours, 4).length <= 4);
  assert.deepEqual(plain(api.hourTicks([9, 10, 11], 5)), [9, 10, 11]);
  assert.deepEqual(plain(api.hourTicks([13], 5)), [13]);
});

test('chart points keep future days in place and leave them unplotted', () => {
  const points = api.chartPoints([{ value: 2 }, { value: 0 }, { value: null }], 320, 150, 16, 16, null, 3);
  assert.deepEqual(points.map((point) => point.x), [16, 160, 304]);
  assert.equal(points[0].y, 16); assert.equal(points[1].y, 134); assert.equal(points[2].y, null);
});

test('the page draws the hour or day axis and a calm empty state', () => {
  const page = fs.readFileSync(path.join(__dirname, '../phone-web/public/statistics.js'), 'utf8');
  assert.match(page, /\$\{label\} by \$\{unitWord\}/);
  assert.match(page, /axisTicks\(series,narrow\?4:5\)/);
  assert.match(page, /className='trendEmpty'/);
  assert.match(page, /if\(p\.y===null\)/, 'future days break the line');
  assert.match(page, /normalizeRange\(new URLSearchParams\(location\.search\)\.get\('range'\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../phone-web/public/statistics.html'), 'utf8'), /id="trendAxis"/);
});
