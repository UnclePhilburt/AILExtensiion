const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '../phone-web/public', file), 'utf8');
const source = `${read('time-zone.js')}\n${read('lead-rules.js')}`.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const rules = vm.createContext({}); vm.runInContext(`${source}; this.doNotKnockWarning = doNotKnockWarning;`, rules);

// Fixed instants so results never depend on the machine's time zone.
// Sep 24-25 2026: Central = UTC-5 (CDT), Eastern = UTC-4 (EDT), Pacific = UTC-7 (PDT).
const central = (day, hour, minute = 0) => new Date(Date.UTC(2026, 8, day, hour + 5, minute));
const union = { requestType: 'Union Member Request' };
const phone = { phoneTimeZone: 'America/Chicago' };
const warn = (lead, at, options = phone) => rules.doNotKnockWarning(lead, at, options);

test('quiet hours start at 7:00 PM Central', () => {
  assert.equal(warn(union, central(24, 18, 59)), null, '6:59 PM Central');
  const flag = warn(union, central(24, 19, 0));
  assert.equal(flag.title, 'DO NOT KNOCK');
  assert.equal(flag.detail, 'Union member lead · Quiet hours started at 7 PM · Use Next to skip this lead.');
  assert.equal(warn({ requestType: 'Association Lead' }, central(24, 19, 5)).detail, 'Association lead · Quiet hours started at 7 PM · Use Next to skip this lead.');
});

test('quiet hours continue overnight and end at 6:00 AM Central', () => {
  assert.ok(warn(union, central(24, 23, 30)));
  assert.ok(warn(union, central(25, 5, 59)), '5:59 AM Central');
  assert.equal(warn(union, central(25, 6, 0)), null, '6:00 AM Central');
  assert.equal(warn(union, central(25, 12, 0)), null);
});

test('the lead\'s impactTimeZone is ignored: always Central', () => {
  for (const impactTimeZone of ['America/New_York', 'America/Los_Angeles', 'Not/AZone']) {
    assert.equal(warn({ ...union, impactTimeZone }, central(24, 18, 59)), null, impactTimeZone);
    assert.equal(warn({ ...union, impactTimeZone }, central(24, 19, 0)).detail, 'Union member lead · Quiet hours started at 7 PM · Use Next to skip this lead.');
  }
});

test('a phone outside Central sees its own time too', () => {
  assert.equal(warn(union, central(24, 19, 5), { phoneTimeZone: 'America/New_York' }).detail,
    'Union member lead · Quiet hours started at 7 PM Central (8 PM your time) · Use Next to skip this lead.');
  assert.equal(warn(union, central(24, 18, 59), { phoneTimeZone: 'America/New_York' }), null, 'the phone clock does not matter');
});

test('IMPACT showing its own do-not-knock notice turns the flag on earlier that evening', () => {
  const lead = { ...union, quietHoursNoticeAt: central(24, 18, 32).toISOString() };
  assert.equal(warn(lead, central(24, 18, 35)).detail,
    'Union member lead · IMPACT showed its do-not-knock notice at 6:32 PM · Use Next to skip this lead.');
  assert.equal(warn(lead, central(24, 21, 0)).detail, 'Union member lead · Quiet hours started at 7 PM · Use Next to skip this lead.');
  assert.equal(warn(lead, central(25, 12, 0)), null, 'expired the next day');
  assert.equal(warn({ ...union, quietHoursNoticeAt: central(24, 16, 0).toISOString() }, central(24, 16, 30)), null, 'not before 5 PM');
  assert.equal(warn({ ...union, quietHoursNoticeAt: central(23, 19, 2).toISOString() }, central(24, 18, 30)), null, 'yesterday\'s notice does not count');
  assert.equal(warn({ ...union, quietHoursNoticeAt: 'garbage' }, central(24, 18, 30)), null);
});

test('leads that are not Union or Association are never flagged', () => {
  for (const at of [central(24, 19, 5), central(24, 23, 0), central(25, 3, 0)]) {
    assert.equal(warn({ requestType: 'Child Safe Kit' }, at), null);
    assert.equal(warn({ requestType: 'Child Safe Kit', quietHoursNoticeAt: at.toISOString() }, at), null);
    assert.equal(warn({}, at), null);
  }
});

test('the phone time zone defaults to the device zone', () => {
  assert.match(rules.doNotKnockWarning(union, central(24, 19, 5)).detail, /^Union member lead · Quiet hours started at 7 PM/);
});
