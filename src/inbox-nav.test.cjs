const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../extension/src/content/impact-diagnostic.js'), 'utf8');
const pure = source.slice(source.indexOf('  function neighborInQueue('), source.indexOf('  const BEST_NEXT_SEEN_KEY'));
const context = vm.createContext({});
vm.runInContext(`${pure}\nthis.neighborInQueue = neighborInQueue; this.leadAfterWorked = leadAfterWorked; this.bestNextPool = bestNextPool; this.otherPhoneBlockedIds = otherPhoneBlockedIds;`, context);

const lead = (leadId) => ({ leadId, url: `https://mobile.impact.ailife.com/Lead/InboxDetail?LeadId=${leadId}`, order: Number(leadId) });
const queue = [lead('1'), lead('2'), lead('3')];

test('Next and Previous follow the Inbox list and stop at the ends', () => {
  assert.equal(context.neighborInQueue(queue, '2', 'next').lead.leadId, '3');
  assert.equal(context.neighborInQueue(queue, '2', 'previous').lead.leadId, '1');
  assert.equal(context.neighborInQueue(queue, '3', 'next').status, 'end');
  assert.equal(context.neighborInQueue(queue, '1', 'previous').status, 'end');
  assert.equal(context.neighborInQueue(queue, '9', 'next').status, 'unknown');
  assert.equal(context.neighborInQueue([], '1', 'next').status, 'unknown');
});

test('after a call, a cursor jump back to an earlier lead is corrected to the next Inbox row', () => {
  const stayed = context.leadAfterWorked(queue, '2', '2');
  assert.equal(stayed.status, 'open');
  assert.equal(stayed.lead.leadId, '3');
  const jumpedBack = context.leadAfterWorked(queue, '2', '1');
  assert.equal(jumpedBack.lead.leadId, '3');
  assert.equal(context.leadAfterWorked(queue, '2', '3').status, 'already');
  assert.equal(context.leadAfterWorked(queue, '3', '3').status, 'end');
});

test('Best next skips people already offered until the Inbox has all been seen', () => {
  const first = context.bestNextPool(queue, '2', []);
  assert.deepEqual(first.pool.map((item) => item.leadId), ['1', '3']);
  assert.equal(first.freshPass, false);
  assert.ok(first.seen.includes('2'));

  const later = context.bestNextPool(queue, '2', ['1']);
  assert.deepEqual(later.pool.map((item) => item.leadId), ['3']);
  assert.equal(later.freshPass, false);

  const restart = context.bestNextPool(queue, '3', ['1', '2']);
  assert.equal(restart.freshPass, true);
  assert.equal([...restart.seen].join(','), '3');
  assert.equal(restart.pool.map((item) => item.leadId).join(','), '1,2');

  const shared = context.bestNextPool(queue, '2', [], ['1']);
  assert.deepEqual(shared.pool.map((item) => item.leadId), ['3']);
  assert.equal(context.neighborInQueue(queue, '1', 'next', ['2']).lead.leadId, '3');
  assert.equal(context.neighborInQueue(queue, '1', 'next', ['2', '3']).status, 'blocked');
});

test('a window skips the other phone’s current and recently worked leads', () => {
  const recent = Date.now();
  const record = { slots: { '1': '9', '2': '4' }, recent: [{ leadId: '7', slot: '2', at: recent }, { leadId: '1', slot: '2', at: recent }, { leadId: '3', slot: '2', at: recent }] };
  assert.equal([...context.otherPhoneBlockedIds(record, '1')].join(','), '4,7,1,3');
  assert.equal([...context.otherPhoneBlockedIds(record, '2')].join(','), '9');
  assert.equal(context.neighborInQueue(queue, '1', 'next', ['4']).lead.leadId, '2');
});

function ranker() {
  const block = source.slice(source.indexOf('  const RECENT_ATTEMPT_MS'), source.indexOf('  function reviewingMessage'));
  const context = vm.createContext({ Intl, Date });
  vm.runInContext(`${block}\nthis.parseInboxActivityTime = parseInboxActivityTime; this.bestLeadTier = bestLeadTier; this.bestCallingGroup = bestCallingGroup; this.bestLeadScore = bestLeadScore;`, context);
  return context;
}
const inboxLead = (leadId, activity, order) => ({ leadId, activity, order, url: 'https://example.test/lead' });

test('best next calls a due callback, then someone never called, and lets a recent no-answer wait', () => {
  const rank = ranker();
  const noAnswer = 'No Answer on Sep 25 2026 7:55 PM';
  const calledAt = rank.parseInboxActivityTime(noAnswer);
  assert.equal(new Date(calledAt).toISOString(), '2026-09-26T00:55:00.000Z');
  assert.equal(rank.bestLeadTier(noAnswer, calledAt + 60 * 60 * 1000), 3, 'a no-answer from the last 4 hours waits');
  assert.equal(rank.bestLeadTier(noAnswer, calledAt + 5 * 60 * 60 * 1000), 2, 'an older no-answer can be called');
  assert.equal(rank.bestLeadTier('', calledAt), 1);
  assert.equal(rank.bestLeadTier(null, calledAt), 2, 'a list saved before activity was recorded is not treated as never called');

  const callback = 'Schedule Call Back appointment on Sep 25 2026 - 02:30 PM';
  const dueAt = rank.parseInboxActivityTime(callback);
  assert.equal(rank.bestLeadTier(callback, dueAt + 60000), 0);
  assert.equal(rank.bestLeadTier(callback, dueAt - 60000), 3);
  const appointment = 'Schedule Virtual Appointment on Sep 25 2026 08:00 PM';
  const appointmentAt = rank.parseInboxActivityTime(appointment);
  assert.equal(rank.bestLeadTier(appointment, appointmentAt - 60000), 4);
  assert.equal(rank.bestLeadTier(appointment, appointmentAt + 60000), 2);

  const due = rank.bestCallingGroup([
    inboxLead('fresh', '', 1),
    inboxLead('recent', noAnswer, 0),
    inboxLead('callback', callback, 4)
  ], dueAt + 60000);
  assert.equal(due.tier, 0);
  assert.deepEqual(due.leads.map((item) => item.leadId), ['callback']);

  const fresh = rank.bestCallingGroup([
    inboxLead('fresh', '', 1),
    inboxLead('recent', noAnswer, 0)
  ], calledAt + 30 * 60 * 1000);
  assert.equal(fresh.tier, 1);
  assert.deepEqual(fresh.leads.map((item) => item.leadId), ['fresh']);

  const ready = rank.bestCallingGroup([
    inboxLead('older', noAnswer, 2),
    inboxLead('just', 'No Answer on Sep 26 2026 12:30 AM', 0)
  ], calledAt + 5 * 60 * 60 * 1000);
  assert.equal(ready.tier, 2);
  assert.deepEqual(ready.leads.map((item) => item.leadId), ['older']);
  assert.equal(rank.bestLeadScore({ requestType: 'Vendor', historyCount: 2 }, { vendor: 1 }), 0.7);
  assert.ok(rank.bestLeadScore({ requestType: 'Vendor', historyCount: 0 }, { vendor: 1 }, 0) > rank.bestLeadScore({ requestType: 'Vendor', historyCount: 0 }, { vendor: 1 }, 30));
});

test('a refusal lowers that request type, and results from this Central hour count more', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../extension/src/background/service-worker.js'), 'utf8');
  const block = worker.slice(worker.indexOf('function outcomePoints('), worker.indexOf('async function requestTypeScores('));
  const context = vm.createContext({});
  vm.runInContext(`${block}\nthis.scoreRequestTypes = scoreRequestTypes;`, context);
  const row = (outcome, hour) => ({ outcome, request_type: 'Vendor', local_hour: hour });
  assert.equal(context.scoreRequestTypes([row('refused-appointment', 10)], 14).vendor, -2);
  assert.equal(context.scoreRequestTypes([row('no-answer', 14)], 14).vendor, -1);
  assert.equal(context.scoreRequestTypes([row('virtual-appointment', 14), row('no-answer', 9)], 14).vendor, 1.67);
  assert.equal(context.scoreRequestTypes([row('virtual-appointment', 9), row('no-answer', 9)], 14).vendor, 1);
  const shown = context.scoreRequestTypes([row('virtual-appointment', 10)], 14, { showUps: [{ request_type: 'Vendor', status: 'held' }, { request_type: 'Vendor', status: 'no-show' }] });
  assert.ok(shown.vendor < context.scoreRequestTypes([row('virtual-appointment', 10)], 14, { showUps: [{ request_type: 'Vendor', status: 'held' }, { request_type: 'Vendor', status: 'held' }] }).vendor);
  assert.match(worker, /scoreRequestTypes\(calls\.data, centralHour\(\)/);
});

test('the phone Best next setting decides where a call result moves, and Next walks the Inbox', () => {
  const app = fs.readFileSync(path.join(__dirname, '../phone-web/public/app.js'), 'utf8');
  assert.match(app, /advance: loadPhoneSettings\(localStorage\)\.bestNextLead \? "best" : "next"/);
  assert.match(source, /if \(command\.type === "next"\) \{\s*await openInboxNeighbor\("next"\);/);
  assert.match(source, /if \(command\.type === "previous"\) \{\s*await openInboxNeighbor\("previous"\);/);
  assert.match(source, /return pending\?\.advance === "best" \? "best" : "next"/);
  assert.doesNotMatch(source, /impact\.leadOrder/);
  assert.match(source, /await openLeadAfterWorked\(pending\.leadId, currentId\)/);
  assert.match(source, /function inboxListReady\(/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
  const opener = manifest.content_scripts.find((item) => (item.js || []).includes('src/content/inbox-page-size.js'));
  assert.equal(opener.world, 'MAIN');
  assert.equal(opener.run_at, 'document_start');
  const pageSize = fs.readFileSync(path.join(__dirname, '../extension/src/content/inbox-page-size.js'), 'utf8');
  assert.match(pageSize, /hdnPageSize/);
  assert.match(pageSize, /page\.len\(100\)/);
});
