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

test('navigation waits briefly for IMPACT to render its arrow before giving up', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/content/impact-diagnostic.js'), 'utf8');
  const fn = source.slice(source.indexOf('  async function clickLeadNavigationButton('), source.indexOf('  function clickLeadCallButton('));
  let lookups = 0, clicked = 0; const messages = [];
  const button = { click: () => { clicked++; } };
  const context = vm.createContext({
    setTimeout: (resolve) => resolve(), Date,
    findLeadNavigationButton: () => (++lookups >= 3 ? button : undefined),
    chrome: { runtime: { sendMessage: async (message) => { messages.push(message); } } }
  });
  vm.runInContext(fn, context);
  await context.clickLeadNavigationButton('up');
  assert.equal(clicked, 1);
  assert.equal(messages.length, 0);
  context.findLeadNavigationButton = () => undefined;
  await context.clickLeadNavigationButton('up', 0);
  assert.match(messages[0].message, /Previous button is unavailable/);
});

test('current lead id is read from LeadId or leadid in the IMPACT URL', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/content/impact-diagnostic.js'), 'utf8');
  const fn = source.slice(source.indexOf('  function getCurrentLeadId('), source.indexOf('  function toSameOriginUrl('));
  const context = vm.createContext({ URL, location: { href: 'https://mobile.impact.ailife.com/Lead/InboxDetail?LeadId=123' } });
  vm.runInContext(fn, context);
  assert.equal(context.getCurrentLeadId(), '123');
  context.location.href = 'https://mobile.impact.ailife.com/Lead/InboxDetail?leadid=456';
  assert.equal(context.getCurrentLeadId(), '456');
  context.location.href = 'https://mobile.impact.ailife.com/Lead/InboxDetail';
  assert.equal(context.getCurrentLeadId(), '');
});
