const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const dir = path.join(__dirname, '../phone-web/public');
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8').replace(/^export /gm, '').replace(/^import .*$/gm, '');
const context = vm.createContext({ Intl, Date });
vm.runInContext(`${read('appointment-outcomes.js')}\n${read('statistics-view.js')}\n${read('alongside-view.js')}\nObject.assign(this, { alongsideSince, tallySelf, sortAlongside, alongsideSentence, heldShare, rhythmBuckets, personFromRow });`, context);

const noon = new Date(2026, 8, 24, 12, 0, 0);

test('Alongside covers today through all time, and all time has no start', () => {
  assert.equal(context.alongsideSince('all', noon), null);
  assert.equal(context.alongsideSince('today', noon).getDate(), 24);
  assert.equal(context.alongsideSince('week', noon).getDay(), 1);
  assert.equal(context.alongsideSince('month', noon).getDate(), 1);
  assert.equal(context.alongsideSince('year', noon).getMonth(), 0);
});

test('a person is counted from calls set and held, then ordered by the chosen number', () => {
  const you = context.tallySelf(
    [{ event_type: 'call', created_at: noon }, { event_type: 'call', created_at: noon }, { event_type: 'virtual-appointment', created_at: noon }],
    [{ status: 'held', apl: 1200, referrals: 1, created_at: noon }, { status: 'no-show', apl: 0, referrals: 0, created_at: noon }]
  );
  assert.equal(you.calls, 2);
  assert.equal(you.scheduled, 1);
  assert.equal(you.held, 1);
  assert.equal(you.noShows, 1);
  assert.equal(you.apl, 1200);
  assert.match(context.alongsideSentence(you), /You · 2 calls · 1 set, 1 held/);
  const quiet = context.tallySelf([], []);
  assert.match(context.alongsideSentence(quiet), /quiet stretch/);
  const ranked = context.sortAlongside([
    { name: 'You', isSelf: true, held: 1 },
    { name: 'Jordan', isSelf: false, held: 3 },
    { name: 'A teammate', isSelf: false, held: 3 }
  ], 'held');
  assert.equal(ranked.map((person) => person.name).join(','), 'A teammate,Jordan,You');
  assert.equal(context.heldShare({ scheduled: 4, held: 2 }), 0.5);
  assert.equal(context.heldShare({ scheduled: 0, held: 2 }), 0);
});

test('the rhythm line stops at today and keeps the whole week in order', () => {
  const buckets = context.rhythmBuckets(
    [{ event_type: 'call', created_at: new Date(2026, 8, 21, 9).toISOString() }, { event_type: 'call', created_at: new Date(2026, 8, 24, 15).toISOString() }],
    [],
    'calls',
    'week',
    noon
  );
  assert.equal(buckets.map((bucket) => bucket.label).join(','), 'Mon,Tue,Wed,Thu,Fri,Sat,Sun');
  assert.equal(buckets[0].value, 1);
  assert.equal(buckets[3].value, 1);
  assert.equal(buckets[4].value, null);
});
