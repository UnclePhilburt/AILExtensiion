const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function insights() {
  const source = fs.readFileSync(path.join(__dirname, '../phone-web/public/timing-insights.js'), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({}); vm.runInContext(source, context); return context;
}
const entry = (outcome, hour, type = 'Globe Life Request') => ({ outcome, local_hour: hour, request_type: type });

test('calling-time insight waits for enough outcomes and recommends a meaningful winning window', () => {
  const h = insights();
  assert.equal(h.findBestCallingTime([entry('virtual-appointment', 14)], 'Globe Life Request'), null);
  const outcomes = [
    ...Array.from({ length: 8 }, () => entry('virtual-appointment', 14)),
    ...Array.from({ length: 4 }, () => entry('no-answer', 14)),
    ...Array.from({ length: 8 }, () => entry('no-answer', 9))
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(h.findBestCallingTime(outcomes, 'Globe Life Request'))), {
    timeLabel: '2–5 PM', reached: 8, total: 12, rate: 67, scope: 'this lead type'
  });
});

test('calling-time insight falls back to overall calls and hides weak patterns', () => {
  const h = insights();
  const overall = [
    ...Array.from({ length: 8 }, () => entry('refused-appointment', 17, 'Union Member')),
    ...Array.from({ length: 4 }, () => entry('no-answer', 17, 'Union Member')),
    ...Array.from({ length: 8 }, () => entry('no-answer', 9, 'Association'))
  ];
  assert.equal(h.findBestCallingTime(overall, 'New Request').scope, 'your overall calls');
  const flat = Array.from({ length: 20 }, (_, index) => entry(index % 2 ? 'no-answer' : 'refused-appointment', index < 10 ? 9 : 14));
  assert.equal(h.findBestCallingTime(flat, 'Globe Life Request'), null);
});
