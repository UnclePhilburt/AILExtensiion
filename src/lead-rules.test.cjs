const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '../phone-web/public', file), 'utf8');
const source = `${read('time-zone.js')}\n${read('lead-rules.js')}`.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const rules = vm.createContext({}); vm.runInContext(`${source}; this.doNotKnockWarning = doNotKnockWarning; this.requestTypeLabel = requestTypeLabel; this.quietHoursLeadKind = quietHoursLeadKind;`, rules);

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

test('leads that are not Union, Association or group leads are never flagged', () => {
  for (const at of [central(24, 19, 5), central(24, 23, 0), central(25, 3, 0)]) {
    for (const requestType of ['Child Safe Kit', 'Globe Life Request', 'Will Kit', 'POS Beneficiary', 'Final Expense', 'AILPlus Non-Customer', 'Sample request']) {
      assert.equal(warn({ requestType }, at), null, requestType);
    }
    assert.equal(warn({ requestType: 'Child Safe Kit', quietHoursNoticeAt: at.toISOString() }, at), null);
    assert.equal(warn({}, at), null);
  }
});

test('the phone time zone defaults to the device zone', () => {
  assert.match(rules.doNotKnockWarning(union, central(24, 19, 5)).detail, /^Union member lead · Quiet hours started at 7 PM/);
});

test('any lead with a group gets the same flag, at the same Central times', () => {
  const ibt = { requestType: 'IBT 610 (SGCOY) (AD&D)' };
  const iuoe = { requestType: 'IUOE 148 (SGK2Q) (AD&D)' };
  assert.equal(warn(ibt, central(24, 18, 59)), null, '6:59 PM Central');
  assert.equal(warn(ibt, central(24, 19, 0)).detail, 'IBT 610 group lead · Quiet hours started at 7 PM · Use Next to skip this lead.');
  assert.equal(warn(iuoe, central(24, 23, 30)).detail, 'IUOE 148 group lead · Quiet hours started at 7 PM · Use Next to skip this lead.');
  assert.ok(warn(ibt, central(25, 5, 59)), '5:59 AM Central');
  assert.equal(warn(ibt, central(25, 6, 0)), null, '6:00 AM Central');
  assert.equal(warn(ibt, central(25, 12, 0)), null);
  assert.equal(warn({ requestType: 'Local 150 (ABC12)' }, central(24, 20, 0)).detail, 'Local 150 group lead · Quiet hours started at 7 PM · Use Next to skip this lead.');
  assert.equal(warn({ requestType: 'Response Card - IBT 610 (SGCOY) (AD&D)' }, central(24, 20, 0)).title, 'DO NOT KNOCK');
  // IMPACT's own notice counts for group leads too.
  assert.equal(warn({ ...ibt, quietHoursNoticeAt: central(24, 18, 32).toISOString() }, central(24, 18, 35)).detail,
    'IBT 610 group lead · IMPACT showed its do-not-knock notice at 6:32 PM · Use Next to skip this lead.');
  // Union / Association wording still decides first.
  assert.equal(warn({ requestType: 'Union Member Request' }, central(24, 20, 0)).detail, 'Union member lead · Quiet hours started at 7 PM · Use Next to skip this lead.');
  assert.equal(warn({ requestType: 'Association Member Request' }, central(24, 20, 0)).detail, 'Association lead · Quiet hours started at 7 PM · Use Next to skip this lead.');
});

test('phone numbers, addresses and ordinary text are not groups', () => {
  for (const requestType of ['(555) 010-0100', 'Mobile: (555) 010-0100', '123 MAIN ST SPRINGFIELD, IL 62704', '123 MAIN ST SPRINGFIELD, IL 62704 (H)', '12 OAK AVE APT 4 (REAR)',
    'HWY 61 (NORTH)', 'Call 3 (No Answer)', 'IBT 610', 'Account 1234 (5678)', 'Child Safe Kit (2)']) {
    assert.equal(rules.quietHoursLeadKind(requestType), '', requestType);
    assert.equal(warn({ requestType }, central(24, 21, 0)), null, requestType);
  }
});

test('badge: a request type that is just a group reads "Response Card · IBT 610"', () => {
  assert.equal(rules.requestTypeLabel('IBT 610 (SGCOY) (AD&D)'), 'Response Card · IBT 610');
  assert.equal(rules.requestTypeLabel('  IUOE 148 (SGK2Q) (AD&D) '), 'Response Card · IUOE 148');
  assert.equal(rules.requestTypeLabel('Union Member Request'), 'Union Member Request');
  assert.equal(rules.requestTypeLabel('Response Card - IBT 610 (SGCOY)'), 'Response Card - IBT 610 (SGCOY)', 'already says what it is');
  assert.equal(rules.requestTypeLabel('Child Safe Kit'), 'Child Safe Kit');
  const read = (file) => fs.readFileSync(path.join(__dirname, '../phone-web/public', file), 'utf8');
  assert.match(read('app.js'), /badge\.textContent = requestTypeLabel\(lead\.requestType\);\n\s*badge\.title = lead\.requestType;/);
  assert.match(read('calendar.js'), /requestTypeLabel\(event\.requestType\)/);
  assert.match(read('settings.html'), /The evening warning on Union, Association and group leads\./);
});
