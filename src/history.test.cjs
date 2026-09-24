const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('lead history preserves repeated calls and appointments and ignores unrelated panels', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/content/impact-diagnostic.js'), 'utf8');
  const fn = source.slice(source.indexOf('  function collectCallHistory('), source.indexOf('  async function prefetchNextLead('));
  const context = vm.createContext({ sanitizeText: value => value.replace(/\s+/g, ' ').trim() });
  vm.runInContext(fn, context);
  const result = context.collectCallHistory({ querySelectorAll: () => [
    { textContent: 'Other lead information' },
    { textContent: 'Show Less... Status No Answer on Sep 23 2026 04:48 PM by Me. No Answer on Sep 23 2026 02:42 PM by Me. Reschedule appointment on Sep 22 2026 06:30 PM by Me.' }
  ] });
  assert.equal(result.length, 3);
  assert.equal(result[0], 'No Answer on Sep 23 2026 04:48 PM by Me.');
  assert.match(result[2], /^Reschedule appointment/);
  assert.equal(context.collectCallHistory({ querySelectorAll: () => [] }).length, 0);
});
