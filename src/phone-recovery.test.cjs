const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({Date});
vm.runInContext(fs.readFileSync('extension/src/shared/phone-recovery.js', 'utf8').replace(/^export /gm, ''), context);

const now = Date.parse('2026-09-28T15:00:00Z');
const state = (changes = {}) => ({
  desktop_seen: new Date(now - 1000).toISOString(),
  phone_seen: new Date(now - 1000).toISOString(),
  slot_phone_seen: {'1': new Date(now - 1000).toISOString()},
  slot_leads: {'1': {leadName:'Alex'}, '2': {leadName:'Jordan'}},
  ...changes
});

test('phone lanes stay distinct and keep a disconnected phone’s lead for recovery', () => {
  const one = context.phoneRecovery(state(), '1', now);
  const two = context.phoneRecovery(state(), '2', now);
  assert.deepEqual({...one}, {id:'1', connected:true, lead:{leadName:'Alex'}, state:'connected', message:'Connected'});
  assert.equal(two.state, 'reconnect');
  assert.equal(two.message, 'Reconnect Phone 2 — its lead is waiting');
  assert.equal(two.lead.leadName, 'Jordan');
});

test('a lane without a lead waits quietly and an offline computer is never shown as a phone-only issue', () => {
  assert.equal(context.phoneRecovery(state({slot_phone_seen:{},slot_leads:{}}), '2', now).state, 'waiting');
  assert.equal(context.phoneRecovery(state({desktop_seen:new Date(now - 46000).toISOString()}), '2', now).state, 'computer-offline');
});

test('phone heartbeat migration records each phone separately and only the account can write it', () => {
  const sql = fs.readFileSync('supabase/migrations/020_phone_slot_heartbeats.sql', 'utf8');
  assert.match(sql, /slot_phone_seen jsonb/);
  assert.match(sql, /companion_phone_seen\(p_slot text/);
  assert.match(sql, /jsonb_build_object\(slot, to_jsonb\(now\(\)\)\)/);
  assert.match(sql, /grant execute on function public\.companion_phone_seen\(text\) to authenticated/);
});
