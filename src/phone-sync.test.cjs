// The phone must follow IMPACT after every result. These cover the races
// behind "the phone gets stuck on the lead it just called".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load() {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/background/phone-sync.js'), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({ setTimeout, Promise });
  vm.runInContext(`${source}\nthis.api = { publisherDecision, createLatestWinsQueue, followLeadChange, verifyPhoneLead, LEAD_CHANGING_COMMANDS };`, context);
  return context.api;
}
const api = load();
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const IMPACT = 'https://mobile.impact.ailife.com/Lead/InboxDetail?LeadId=2';
const SALEBASE = 'https://salebase.ai/phone_scripts/phone_scripts.php';

test('ROOT CAUSE: the IMPACT tab may publish even when the Salebase script window has focus', () => {
  const impactTab = { id: 1, url: IMPACT, active: true, windowId: 10 };
  const salebaseFocused = { id: 7, url: SALEBASE, active: true, windowId: 20 };
  // 0.4.14 required impactTab to be the active tab of the last focused window,
  // so with Salebase focused (a rebuttal focuses it) every new lead was dropped.
  const oldRule = (sender, focused) => (!sender?.id || sender.id !== focused?.id ? 'inactive tab' : '');
  assert.equal(oldRule(impactTab, salebaseFocused), 'inactive tab', 'the old rule dropped it');
  assert.equal(api.publisherDecision(impactTab, salebaseFocused), '');
  assert.equal(api.publisherDecision(impactTab, impactTab), '');
  assert.equal(api.publisherDecision(impactTab, undefined), '', 'focus outside Chrome');
  // Still protected: a background IMPACT tab, or another IMPACT lead tab in front.
  assert.equal(api.publisherDecision({ ...impactTab, active: false }, salebaseFocused), 'background tab');
  assert.equal(api.publisherDecision(impactTab, { id: 3, url: 'https://mobile.impact.ailife.com/Lead/InboxDetail?LeadId=9', active: true }), 'another IMPACT tab is in front');
  assert.equal(api.publisherDecision({ id: 4, url: SALEBASE, active: true }, null), 'not an IMPACT lead page');
  assert.equal(api.publisherDecision(null, null), 'no tab');
});

// A fake cloud row where each write takes a given time, like two HTTP requests in flight.
function fakeCloud() {
  const row = { leadId: 'A', writes: [] };
  return { row, write: (leadId, ms) => new Promise((resolve) => setTimeout(() => { row.leadId = leadId; row.writes.push(leadId); resolve({ ok: true }); }, ms)) };
}

test('RACE: overlapping writes let the old lead land last; the ordered queue never does', async () => {
  // Old behaviour: the previous lead's write is slow, the new lead's is fast.
  const loose = fakeCloud();
  await Promise.all([loose.write('A', 40), loose.write('B', 5)]);
  assert.equal(loose.row.leadId, 'A', 'without ordering the phone ends on the old lead');

  const cloud = fakeCloud();
  const queue = api.createLatestWinsQueue();
  const first = queue.run(() => cloud.write('A', 40));
  await new Promise((resolve) => setTimeout(resolve, 2)); // A is in flight
  const middle = queue.run(() => cloud.write('A2', 1));
  const last = queue.run(() => cloud.write('B', 5));
  const results = await Promise.all([first, middle, last]);
  assert.equal(cloud.row.leadId, 'B');
  assert.deepEqual(cloud.row.writes, ['A', 'B'], 'a write overtaken while queued is skipped');
  assert.equal(results[1].reason, 'superseded');
  assert.equal(queue.written, 3);
});

test('a write queued before anything started is skipped when a newer one follows', async () => {
  const cloud = fakeCloud();
  const queue = api.createLatestWinsQueue();
  await Promise.all([queue.run(() => cloud.write('A', 5)), queue.run(() => cloud.write('B', 5))]);
  assert.deepEqual(cloud.row.writes, ['B']);
});

test('forced writes (Sync phone, follow, resync) always run, in order', async () => {
  const cloud = fakeCloud();
  const queue = api.createLatestWinsQueue();
  const a = queue.run(() => cloud.write('A', 20));
  await new Promise((resolve) => setTimeout(resolve, 2));
  const b = queue.run(() => cloud.write('B', 1), { mustRun: true });
  const c = queue.run(() => cloud.write('C', 1));
  await Promise.all([a, b, c]);
  assert.deepEqual(cloud.row.writes, ['A', 'B', 'C']);
  // A failed write does not block the next one.
  await queue.run(() => Promise.reject(new Error('offline'))).catch(() => {});
  await queue.run(() => cloud.write('D', 1));
  assert.equal(cloud.row.leadId, 'D');
});

test('after a result, the extension waits for IMPACT to show the next lead, then publishes it', async () => {
  const logs = []; const published = []; const verified = [];
  // WhatHappend page (no lead), back on the same lead, page loading, then the next lead.
  const pages = [null, { available: true, leadId: 'A' }, null, { available: true, leadId: 'A' }, { available: true, leadId: 'B', leadName: 'NEXT, LEAD' }];
  let t = 0;
  const outcome = await api.followLeadChange({
    fromLeadId: 'A',
    readLead: async () => (pages.length ? pages.shift() : { available: true, leadId: 'B' }),
    publish: async (lead) => { published.push(lead.leadId); },
    verify: async (id) => { verified.push(id); },
    log: async (level, event) => { logs.push(event); },
    now: () => t, sleep: async (ms) => { t += ms; }
  });
  assert.equal(outcome, 'published');
  assert.deepEqual(published, ['B']);
  assert.deepEqual(verified, ['B']);
  assert.deepEqual(logs, ['phoneSync.followStarted', 'phoneSync.newLeadSeen']);

  const timeoutLogs = [];
  t = 0;
  assert.equal(await api.followLeadChange({ fromLeadId: 'A', readLead: async () => { throw new Error('page navigating'); }, publish: async () => assert.fail('nothing to publish'), verify: async () => {}, log: async (_l, e) => { timeoutLogs.push(e); }, now: () => t, sleep: async (ms) => { t += ms; }, timeoutMs: 5000 }), 'timed-out');
  assert.deepEqual(timeoutLogs, ['phoneSync.followStarted', 'phoneSync.followTimedOut']);
  assert.equal(await api.followLeadChange({ fromLeadId: 'A', isCurrent: () => false, readLead: async () => null, publish: async () => {}, verify: async () => {}, log: async () => {}, now: () => 0, sleep: async () => {} }), 'replaced');
});

test('if the phone still has the old lead a few seconds later, it is resynced automatically', async () => {
  const logs = []; let phone = 'A'; let resyncs = 0;
  const outcome = await api.verifyPhoneLead({
    expectedLeadId: 'B', readPhoneLeadId: async () => phone,
    republish: async () => { resyncs += 1; phone = 'B'; },
    log: async (_l, event, details) => { logs.push([event, details.attempt]); }, sleep: async () => {}
  });
  assert.equal(outcome, 'ok');
  assert.equal(resyncs, 1);
  assert.deepEqual(logs, [['phoneSync.mismatch', 1], ['phoneSync.resynced', 1], ['phoneSync.verified', 2]]);
  // IMPACT moved on again meanwhile: do not push the older lead back.
  let latest = 'B';
  assert.equal(await api.verifyPhoneLead({ expectedLeadId: 'B', currentLeadId: () => latest, readPhoneLeadId: async () => 'A', republish: async () => assert.fail('never resync an older lead'), log: async () => {}, sleep: async () => { latest = 'C'; } }), 'lead-moved-on');
  // Bounded: gives up after the attempts.
  let tries = 0;
  assert.equal(await api.verifyPhoneLead({ expectedLeadId: 'B', readPhoneLeadId: async () => 'A', republish: async () => { tries += 1; }, log: async () => {}, sleep: async () => {} }), 'gave-up');
  assert.equal(tries, 3);
});

test('service worker wiring: no focused-window gate, ordered writes, follow after commands, Sync phone forces', () => {
  const worker = read('extension/src/background/service-worker.js');
  const auto = worker.slice(worker.indexOf('async function autoPublishLead'), worker.indexOf('// Every lead write goes through here'));
  assert.doesNotMatch(auto, /senderTab\.id !== active\?\.id/, 'the lastFocusedWindow gate that dropped leads is gone');
  assert.match(auto, /const skip = await publishSkipReason\(senderTab\);/);
  assert.doesNotMatch(worker.slice(worker.indexOf('async function publishAppointmentOptions'), worker.indexOf('async function reportCommandResult')), /senderTab\.id !== active\?\.id/);
  assert.match(worker, /return leadWrites\.run\(\(seq\) => writeLead\(lead, seq, options\), \{ mustRun: Boolean\(options\.force\) \}\);/);
  assert.match(worker, /if \(command\?\.type && LEAD_CHANGING_COMMANDS\.includes\(command\.type\)\) \{\n\s*void followAfterCommand\(senderTab\.id, command\.leadId \|\| latestLeadId\);/);
  assert.match(worker, /publishLead\(message\.lead, \{ force: true, eventName: 'phoneSync\.manualSync' \}\)/);
  assert.match(worker, /void checkPhoneHasLead\(lead\.leadId\);/);
  for (const event of ['phoneSync.publishSkipped', 'phoneSync.published', 'phoneSync.publishFailed', 'phoneSync.followPublished', 'phoneSync.resync']) assert.ok(worker.includes(event), event);
  const cloud = read('extension/src/background/cloud-desktop.js');
  assert.match(cloud, /client\.rpc\('companion_desktop',\{p_device:await device\(\),p_lead:lead\}\)\.abortSignal\(AbortSignal\.timeout\(10000\)\)/);
  assert.match(cloud, /export async function cloudLeadId\(\)/);
  assert.deepEqual([...api.LEAD_CHANGING_COMMANDS], ['no-answer', 'refused-appointment', 'virtual-appointment-slot', 'next', 'previous']);
});

// The IMPACT page script, just the parts that decide whether a lead is published.
function loadImpactHelpers(clock) {
  const source = read('extension/src/content/impact-diagnostic.js');
  const grab = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const logs = [];
  const context = vm.createContext({ Date: { now: () => clock.now }, log: async (level, event, details) => { logs.push([event, details]); } });
  vm.runInContext([
    'const INCOMPLETE_LEAD_SETTLE_MS = 2000;', 'let incompleteLead = { leadId: "", since: 0, logged: false };',
    grab('  function leadReadyForPhone', '  async function runAutoPublishCheck'),
    grab('  function extractLeadName', '  // Optional "Label: value"'),
    grab('  function sanitizeText', '  function redactCustomerText'),
    'this.api = { leadReadyForPhone, extractLeadName };'
  ].join('\n'), context);
  return { ...context.api, logs };
}

test('a lead whose name or phones are not recognised still reaches the phone after 2 seconds', () => {
  const clock = { now: 0 };
  const impact = loadImpactHelpers(clock);
  assert.equal(impact.leadReadyForPhone({ leadId: '1', leadName: 'A, B', phones: [{}] }), true);
  const odd = { leadId: '2', leadName: '', phones: [{}] };
  assert.equal(impact.leadReadyForPhone(odd), false, 'may still be rendering');
  clock.now = 1500; assert.equal(impact.leadReadyForPhone(odd), false);
  clock.now = 2100; assert.equal(impact.leadReadyForPhone(odd), true, '0.4.14 never published it');
  assert.deepEqual(JSON.parse(JSON.stringify(impact.logs)), [['phoneSync.incompleteLead', { hasName: false, phoneCount: 1 }]]);
  assert.equal(impact.leadReadyForPhone({ leadId: '', leadName: '', phones: [] }), false, 'no lead id: never');
  assert.equal(impact.extractLeadName('Lead CARTER JR., JAMES edit Language: English'), 'CARTER JR., JAMES');
  assert.equal(impact.extractLeadName('Lead CARTER, JAMES edit'), 'CARTER, JAMES');
});

test('IMPACT page wiring: checks are never dropped while busy, and the lead can be read on request', () => {
  const impact = read('extension/src/content/impact-diagnostic.js');
  assert.match(impact, /if \(autoPublishBusy\) \{ autoPublishAgain = true; return; \}/);
  assert.match(impact, /if \(autoPublishAgain\) \{ autoPublishAgain = false; window\.setTimeout\(runAutoPublishCheck, 0\); \}/);
  assert.match(impact, /message\?\.type === "impact\/readCurrentLead"/);
  assert.match(impact, /if \(!lead\.available \|\| !leadReadyForPhone\(lead\)\) \{/);
  assert.doesNotMatch(impact, /!lead\.leadName \|\| !lead\.phones\?\.length/);
});
