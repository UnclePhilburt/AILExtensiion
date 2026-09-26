const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const vm = require('node:vm'); const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../phone-web/public/statistics-view.js'), 'utf8').replace(/^export /gm, '');
const api = vm.createContext({ Date, String, Number, Math, Map, Array }); vm.runInContext(`${src}; this.rangeStart=rangeStart; this.metricRows=metricRows; this.dailyTrend=dailyTrend; this.chartPoints=chartPoints; this.comparisonWindows=comparisonWindows; this.comparisonTrend=comparisonTrend;`, api);
test('statistics ranges begin on the right local day', () => { const now = new Date('2026-09-25T15:00:00'); assert.equal(api.rangeStart('today', now).getHours(), 0); assert.equal(api.rangeStart('month', now).getDate(), 1); assert.equal(api.rangeStart('ytd', now).getMonth(), 0); });
test('trend groups daily calls, appointments, APL and referrals', () => { const events = [{event_type:'call',created_at:'2026-09-24T10:00:00'}, {event_type:'call',created_at:'2026-09-25T10:00:00'}]; const outcomes = [{status:'held',apl:1200,referrals:2,created_at:'2026-09-25T12:00:00'}]; assert.deepEqual(JSON.parse(JSON.stringify(api.dailyTrend(events,outcomes,'calls'))), [{day:'2026-09-24',value:1},{day:'2026-09-25',value:1}]); assert.deepEqual(JSON.parse(JSON.stringify(api.dailyTrend(events,outcomes,'apl'))), [{day:'2026-09-25',value:1200}]); assert.equal(api.metricRows(events,outcomes).referrals, 2); assert.equal(api.chartPoints([{day:'a',value:4}])[0].y, 16); });

test('comparison trend aligns today with yesterday and averages the four prior periods', () => {
  const now = new Date('2026-09-25T15:00:00');
  const events = [{event_type:'call',created_at:'2026-09-25T10:00:00'}, {event_type:'call',created_at:'2026-09-24T10:00:00'}, {event_type:'call',created_at:'2026-09-21T10:00:00'}];
  const previous = api.comparisonTrend(events, [], 'calls', 'today', 'previous', now);
  assert.equal(previous.current[0].value, 1); assert.equal(previous.comparison[0].value, 1);
  const average = api.comparisonTrend(events, [], 'calls', 'today', 'average', now);
  assert.equal(average.comparison.length, 1); assert.equal(average.label, 'Average of previous four periods');
  assert.equal(api.comparisonWindows('week','four-back',now).comparisons[0].label, 'Four weeks ago');
});
