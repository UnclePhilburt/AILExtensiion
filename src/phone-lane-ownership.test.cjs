const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(initial) {
  let map = { ...initial };
  const read = (file) => fs.readFileSync(path.join(__dirname, '../extension/src/background', file), 'utf8');
  const worker = read('service-worker.js');
  const extract = (start, end) => worker.slice(worker.indexOf(start), worker.indexOf(end, worker.indexOf(start)));
  const context = vm.createContext({
    liveSlotMap: async () => ({ ...map }),
    writeWindowSlots: async (value) => { map = { ...value }; }
  });
  vm.runInContext(read('phone-sync.js').replace(/^export /gm, '') + '\nlet slotClaims = Promise.resolve();\n' +
    extract('function queueSlotClaim(', 'async function liveSlotMap(') +
    extract('function slotForTab(', 'function setTabSlot(') +
    extract('async function impactTabForLane(', 'async function clickSalebaseCallLink('), context);
  return { context, map: () => map };
}

test('recovery never steals Phone 2 when Phone 1 has no available tab', async () => {
  const { context, map } = setup({ 20: '2' });
  assert.equal(await context.impactTabForLane([{ id: 20 }], '1'), null);
  assert.deepEqual(map(), { 20: '2' });
});

test('a navigating phone keeps its assignment even when its tab is absent from lead pages', async () => {
  const { context, map } = setup({ 10: '1', 20: '2' });
  assert.equal(await context.impactTabForLane([{ id: 10 }, { id: 30 }], '2'), null);
  assert.deepEqual(map(), { 10: '1', 20: '2' });
  assert.equal(await context.slotForTab({ id: 30 }), '');
  assert.equal(await context.slotForTab(null), '');
});

test('simultaneous recoveries claim different tabs and preserve later publications', async () => {
  const { context, map } = setup({});
  const tabs = [{ id: 10, windowId: 1, index: 0 }, { id: 20, windowId: 2, index: 0 }];
  const [first, second] = await Promise.all([
    context.impactTabForLane(tabs, '1'), context.impactTabForLane(tabs, '2')
  ]);
  assert.equal(first.id, 10);
  assert.equal(second.id, 20);
  assert.deepEqual(map(), { 10: '1', 20: '2' });
  assert.equal(await context.slotForTab(tabs[1]), '2');
  assert.equal(await context.slotForTab(tabs[0]), '1');
});
