const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('navigation recognizes captured IMPACT actions without relying on icon children', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/content/impact-diagnostic.js'), 'utf8');
  const fn = source.slice(source.indexOf('  function findLeadNavigationButton('), source.indexOf('  async function runAutoPublishCheck('));
  const button = (action, text, visible = true, disabled = false) => ({
    disabled, innerText: text,
    getAttribute: name => name === 'onclick' ? action : null,
    getClientRects: () => visible ? [{}] : []
  });
  const previous = button("location.href='/Lead/MovePrevious?leadid=123'", 'keyboard_arrow_up');
  const next = button("location.href='/Lead/MoveNext?leadid=123'", 'keyboard_arrow_down');
  let buttons = [button(previous.getAttribute('onclick'), '', false), button(previous.getAttribute('onclick'), '', true, true), next, previous];
  const context = vm.createContext({ document: { querySelectorAll: () => buttons }, sanitizeText: text => text.trim() });
  vm.runInContext(fn, context);
  assert.equal(context.findLeadNavigationButton('up'), previous);
  assert.equal(context.findLeadNavigationButton('down'), next);
  buttons = [button('', 'keyboard_arrow_up')];
  assert.equal(context.findLeadNavigationButton('up'), buttons[0]);
  assert.equal(context.findLeadNavigationButton('down'), undefined);
});
