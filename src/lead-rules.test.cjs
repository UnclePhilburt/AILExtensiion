const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../phone-web/public/lead-rules.js'), 'utf8').replace(/^export /gm, '');
const rules = vm.createContext({}); vm.runInContext(`${source}; this.doNotKnockWarning = doNotKnockWarning;`, rules);
const at = (hour) => new Date(2026, 8, 24, hour, 0);

test('Union and Association leads receive a do-not-knock warning at 8 PM', () => {
  assert.equal(rules.doNotKnockWarning({ requestType: 'Union Member Request' }, at(19)), null);
  assert.match(rules.doNotKnockWarning({ requestType: 'Union Member Request' }, at(20)).title, /DO NOT KNOCK/);
  assert.match(rules.doNotKnockWarning({ requestType: 'Association Lead' }, at(20)).detail, /Association/);
  assert.equal(rules.doNotKnockWarning({ requestType: 'Child Safe Kit' }, at(20)), null);
});
