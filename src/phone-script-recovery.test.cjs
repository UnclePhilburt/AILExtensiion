const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const worker = fs.readFileSync(path.join(__dirname, '../extension/src/background/service-worker.js'), 'utf8');
const extract = (start, end) => worker.slice(worker.indexOf(start), worker.indexOf(end, worker.indexOf(start)));

test('both phones and replacement script windows retain their own lead during concurrent updates', async () => {
  let records = {};
  const fields1 = { fields: { name: 'Phone One' }, sourceTabId: 1 };
  const fields2 = { fields: { name: 'Phone Two' }, sourceTabId: 2 };
  const context = vm.createContext({
    laneKey: (slot) => slot,
    laneScriptFields: new Map([['1', fields1], ['2', fields2]]),
    pendingSalebaseChoices: new Map(), SCRIPT_LEADS_KEY: 'leads',
    scriptSlotMap: async () => ({ 10: '1', 20: '2', 21: '2' }),
    chrome: { storage: { session: {
      get: async () => ({ leads: structuredClone(records) }),
      set: async (value) => { await new Promise(setImmediate); records = value.leads; }
    } } }
  });
  vm.runInContext(extract('let scriptLeadWrites', 'async function clearImpactScriptLeadForTab'), context);
  await Promise.all([context.syncScriptLeadForLane('1'), context.syncScriptLeadForLane('2')]);
  assert.equal(records['10'].fields.name, 'Phone One');
  assert.equal(records['20'].fields.name, 'Phone Two');
  assert.equal(records['21'].fields.name, 'Phone Two');
  assert.equal(records['21'].slot, '2');
});

test('reopening Phone 2 script also republishes its live lead without script-only details', async () => {
  const lead = { available: true, leadId: 'two', leadName: 'Phone Two', scriptDetails: { group: 'private' } };
  let published;
  const context = vm.createContext({
    chrome: { tabs: { query: async () => [{ id: 2 }], sendMessage: async () => ({ lead }) } },
    impactTabForLane: async () => ({ id: 2 }), noteScriptGroup() {}, slotMemory: new Map(),
    rememberScriptLead: async () => {}, openMatchingSalebaseScript: async () => {},
    publishLead: async (value, options) => { published = { value, options }; }
  });
  vm.runInContext(extract('async function reopenPhoneScriptsForLane', 'async function impactTabForLane'), context);
  await context.reopenPhoneScriptsForLane('2');
  assert.equal(published.value.leadId, 'two');
  assert.equal(published.value.scriptDetails, undefined);
  assert.equal(published.options.slot, '2');
  assert.equal(published.options.force, true);
});
