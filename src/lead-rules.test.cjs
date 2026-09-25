const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../phone-web/public/lead-rules.js'), 'utf8').replace(/^export /gm, '');
const rules = vm.createContext({}); vm.runInContext(`${source}; this.doNotKnockWarning = doNotKnockWarning;`, rules);

// Fixed instants so results never depend on the machine's time zone.
// Sep 24-25 2026: Central = UTC-5 (CDT), Eastern = UTC-4 (EDT), Pacific = UTC-7 (PDT).
const central = (day, hour, minute = 0) => new Date(Date.UTC(2026, 8, day, hour + 5, minute));
const union = { requestType: 'Union Member Request' };
const phone = { phoneTimeZone: 'America/Chicago' };
const warn = (lead, at, options = phone) => rules.doNotKnockWarning(lead, at, options);

test('quiet hours start at 8 PM Eastern (7 PM Central) by default', () => {
  assert.equal(warn(union, central(24, 18, 55)), null, '6:55 PM Central = 7:55 PM Eastern');
  const flag = warn(union, central(24, 19, 5));
  assert.equal(flag.title, 'DO NOT KNOCK AFTER 8 PM');
  assert.equal(flag.detail, 'Union member lead · 8 PM Eastern (7 PM your time) · Use Next to skip this lead.');
  assert.match(warn({ requestType: 'Association Lead' }, central(24, 19, 5)).detail, /^Association lead · 8 PM Eastern/);
});

test('quiet hours continue overnight and end at 6 AM in IMPACT time', () => {
  assert.ok(warn(union, central(24, 23, 30)));
  assert.ok(warn(union, central(25, 4, 59)), '5:59 AM Eastern');
  assert.equal(warn(union, central(25, 5, 0)), null, '6:00 AM Eastern');
  assert.equal(warn(union, central(25, 12, 0)), null);
});

test('the cutoff follows the IMPACT time zone the extension reports', () => {
  const centralImpact = { ...union, impactTimeZone: 'America/Chicago' };
  assert.equal(warn(centralImpact, central(24, 19, 5)), null);
  assert.equal(warn(centralImpact, central(24, 20, 0)).detail, 'Union member lead · 8 PM Central · Use Next to skip this lead.');
  const pacificImpact = { ...union, impactTimeZone: 'America/Los_Angeles' };
  assert.equal(warn(pacificImpact, central(24, 21, 55)), null);
  assert.equal(warn(pacificImpact, central(24, 22, 5)).detail, 'Union member lead · 8 PM Pacific (10 PM your time) · Use Next to skip this lead.');
  const eastCoastPhone = warn(union, central(24, 19, 5), { phoneTimeZone: 'America/New_York' });
  assert.match(eastCoastPhone.detail, /8 PM Eastern · Use Next/);
  assert.ok(warn({ ...union, impactTimeZone: 'Not/AZone' }, central(24, 19, 5)), 'unknown zones fall back to Eastern');
});

test('IMPACT showing its own after-8 PM notice turns the flag on for that evening', () => {
  // The IMPACT zone setting is wrong (Pacific) but IMPACT already showed its notice.
  const lead = { ...union, impactTimeZone: 'America/Los_Angeles', quietHoursNoticeAt: central(24, 19, 2).toISOString() };
  assert.equal(warn(lead, central(24, 19, 5)).detail,
    'Union member lead · IMPACT showed its after-8 PM notice at 7:02 PM · Use Next to skip this lead.');
  assert.ok(warn(lead, central(24, 21, 0)));
  assert.equal(warn(lead, central(25, 12, 0)), null, 'expired the next day');
  assert.equal(warn({ ...lead, quietHoursNoticeAt: central(23, 19, 2).toISOString() }, central(24, 19, 5)), null, 'yesterday\'s notice does not count');
  assert.equal(warn({ ...lead, quietHoursNoticeAt: 'garbage' }, central(24, 19, 5)), null);
});

test('leads that are not Union or Association are never flagged', () => {
  for (const at of [central(24, 19, 5), central(24, 23, 0), central(25, 3, 0)]) {
    assert.equal(warn({ requestType: 'Child Safe Kit' }, at), null);
    assert.equal(warn({ requestType: 'Child Safe Kit', quietHoursNoticeAt: at.toISOString() }, at), null);
    assert.equal(warn({}, at), null);
  }
});

test('the phone time zone defaults to the device zone', () => {
  const flag = rules.doNotKnockWarning(union, central(24, 19, 5));
  assert.match(flag.detail, /^Union member lead · 8 PM Eastern/);
});
