const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '../phone-web/public', file), 'utf8');
const app = read('app.js');
const stateForSend = app.slice(app.indexOf('async function stateForSend()'), app.indexOf('async function ensureSession()'));
const cloud = read('cloud-sync.js');
const slotView = cloud.slice(cloud.indexOf('export function slotView('), cloud.indexOf('export function visibleLead(')).replace('export ', '');

for (const slot of ['1', '2']) {
  test(`Phone ${slot} validates the first action after a refresh against its own lead`, async () => {
    const now = Date.now();
    const stamp = new Date(now).toISOString();
    const state = { lead: { leadId: 'one' }, desktop_seen: stamp, lead_updated_at: stamp,
      slot_leads: { '1': { leadId: 'one' }, '2': { leadId: 'two' } },
      slot_seen: { '1': stamp, '2': stamp } };
    let fetches = 0;
    const context = vm.createContext({ Date, setTimeout, clearTimeout,
      cloudState: async () => { fetches++; return state; },
      ensureSession: async () => {}, slot });
    vm.runInContext(read('phone-actions.js').replace(/^export /gm, ''), context);
    vm.runInContext(`${slotView}
      let currentCloudState = null, lastCloudFetchAt = 0, lastHiddenAt = 0;
      const signedIn = true;
      function applyCloudState(state, startedAt) {
        if (startedAt < lastCloudFetchAt) return false;
        lastCloudFetchAt = startedAt;
        currentCloudState = slotView(state, slot);
      }
      ${stateForSend}
      this.sendState = stateForSend;
      this.validate = checkBeforeSend;
    `, context);
    const command = { type: 'no-answer', leadId: slot === '2' ? 'two' : 'one' };
    const first = await context.sendState();
    assert.equal(context.validate(first, command, now), '');
    assert.equal(context.validate(await context.sendState(), command, now), '');
    assert.equal(fetches, 1, 'the next action uses the same correctly selected state');
    assert.match(context.validate(first, { ...command, leadId: 'wrong' }, now), /different lead/);
  });
}
