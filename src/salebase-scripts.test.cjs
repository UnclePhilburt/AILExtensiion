const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('IMPACT request types choose the matching Salebase phone script', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/background/salebase-scripts.js'), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({}); vm.runInContext(source, context);
  const choose = context.salebaseOptionForRequestType;
  assert.equal(choose('Response Card'), 'Response Card');
  assert.equal(choose('Child Safe Referral'), 'Child Safe Referral');
  assert.equal(choose('Child Safe Kit'), 'Child Safe');
  assert.equal(choose('POS Beneficiary Request'), 'POS Beneficiary');
  assert.equal(choose('Globe Life Request'), 'Globe');
  assert.equal(choose('AILPlus Non-Customer'), 'AILPlus (Non-Customer)');
  assert.equal(choose('Union Member'), '');
});
