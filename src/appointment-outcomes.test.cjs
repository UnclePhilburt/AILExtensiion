const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../phone-web/public/appointment-outcomes.js'), 'utf8').replace(/^export /gm, '');
const api = vm.createContext({ Number, String, Math, Date, Intl }); vm.runInContext(`${source}; this.appointmentOutcomeInput=appointmentOutcomeInput; this.appointmentTotals=appointmentTotals;`, api);
test('appointment results accept held, no-show and rescheduled records safely', () => {
  assert.equal(api.appointmentOutcomeInput({ status: 'no-show', apl: 100 }).status, 'no-show');
  const rescheduled = api.appointmentOutcomeInput({ status: 'rescheduled', rescheduledFor: '2026-09-28T15:30:00' });
  assert.equal(rescheduled.status, 'rescheduled'); assert.ok(rescheduled.rescheduled_for);
  assert.equal(api.appointmentOutcomeInput({ status: 'unknown', apl: -5 }).status, 'held');
});
test('today totals include production and every appointment disposition', () => {
  const now = new Date('2026-09-25T15:00:00');
  const totals = api.appointmentTotals([{ status: 'held', apl: 1200, referrals: 2, created_at: '2026-09-25T09:00:00' }, { status: 'no-show', apl: 0, referrals: 0, created_at: '2026-09-25T11:00:00' }, { status: 'rescheduled', apl: 0, referrals: 0, created_at: '2026-09-25T12:00:00' }], now);
  assert.deepEqual(JSON.parse(JSON.stringify(totals)), { held: 1, noShow: 1, rescheduled: 1, apl: 1200, referrals: 2 });
});
