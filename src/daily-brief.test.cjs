const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../phone-web/public/daily-brief.js'), 'utf8').replace(/^export /gm, '');
const api = vm.createContext({ Date, Set, Map, Math, String, Number });
vm.runInContext(`${source}; this.dailyBrief = dailyBrief;`, api);
const event = (type, at) => ({ event_type: type, created_at: at });

test('daily brief tells the story of today from the first call and outcomes', () => {
  const now = new Date('2026-09-25T15:00:00');
  const summary = api.dailyBrief([
    event('call', '2026-09-25T14:00:00'), event('call', '2026-09-25T14:20:00'),
    event('no-answer', '2026-09-25T14:24:00'), event('virtual-appointment', '2026-09-25T14:45:00')
  ], now);
  assert.equal(summary.greeting, 'Good afternoon');
  assert.equal(summary.calls, 2); assert.equal(summary.results, 2); assert.equal(summary.appointments, 1);
  assert.match(summary.story, /2:00 PM/); assert.match(summary.story, /1 hour/); assert.ok(summary.chapters.length >= 3);
});

test('comparison uses earlier days only through the same time of day', () => {
  const now = new Date('2026-09-25T15:00:00');
  const summary = api.dailyBrief([
    event('call', '2026-09-25T14:00:00'), event('call', '2026-09-25T14:30:00'),
    event('call', '2026-09-24T10:00:00'), event('call', '2026-09-24T14:00:00'), event('call', '2026-09-24T17:00:00')
  ], now);
  assert.match(summary.comparison, /recent daily pace of 2 calls/);
});

test('evening reflection closes the day calmly', () => {
  const summary = api.dailyBrief([event('call', '2026-09-25T20:00:00')], new Date('2026-09-25T21:05:00'));
  assert.equal(summary.greeting, 'Good evening'); assert.equal(summary.evening, true);
  assert.match(summary.reflection, /1 call/);
});

test('story chapters respond to each real kind of result', () => {
  const now = new Date('2026-09-25T15:00:00');
  const summary = api.dailyBrief([
    event('call', '2026-09-25T14:00:00'), event('no-answer', '2026-09-25T14:05:00'),
    event('virtual-appointment', '2026-09-25T14:15:00'), event('refused-appointment', '2026-09-25T14:25:00')
  ], now);
  assert.ok(summary.chapters.length >= 6);
  assert.match(summary.story, /1 no-answer/); assert.match(summary.story, /1 appointment/); assert.match(summary.story, /1 refusal/);
});
