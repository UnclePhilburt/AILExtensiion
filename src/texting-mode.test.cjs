const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../phone-web/public/texting-mode.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function harness() {
  const make = (tag) => ({ tag, children: [], events: {}, value: '', checked: false,
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    setAttribute() {}, addEventListener(name, fn) { this.events[name] = fn; }
  });
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  let lead = { available: true, leadId: '123', leadName: 'SMITH, JANE', requestType: 'Response Card', phones: [{ label: 'Mobile', number: '3145550100' }] };
  const calls = [];
  const context = vm.createContext({ document: { createElement: make }, navigator: { userAgent: 'iPhone' }, crypto: require('node:crypto'), setTimeout: fn => fn() });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../phone-web/public/text-learning.js'), 'utf8').replace(/^export /gm, ''), context); vm.runInContext(source, context);
  const root = make('section');
  const seed = { enabled: true, company: 'American Income Life', agent: 'Cody', templates: {}, records: [], pending: {} };
  storage.setItem('impact.texting.v1.user', JSON.stringify(seed));
  const mode = context.createTextingMode(root, { storage, getUser: () => 'user', getSlot: () => '2', getLead: () => lead, getAgent: () => 'Cody', tracking: { save: async () => {}, list: async () => [], checkin: async () => null }, registerCall: async draft => { calls.push(draft); return true; } });
  const all = () => { const rows = []; const walk = node => { rows.push(node); node.children.forEach(walk); }; walk(root); return rows; };
  const find = text => all().find(node => node.textContent === text);
  mode.sync();
  return { context, root, mode, calls, storage, all, find, state: () => JSON.parse(storage.getItem('impact.texting.v1.user')), move: () => { lead = { ...lead, leadId: 'other' }; } };
}
test('A/B assignment is stable per lead and each message has correct placeholders', () => {
  const { context } = harness();
  const first = context.textVariant('user', 'lead', 'experiment');
  assert.equal(context.textVariant('user', 'lead', 'experiment'), first);
  const variants = new Set(Array.from({ length: 100 }, (_, i) => context.textVariant('user', String(i), 'experiment')));
  assert.equal(variants.size, 2);
  assert.equal(context.textFirstName('SMITH, JANE'), 'Jane');
  assert.equal(context.fillText('Hi {firstName}, {agentName} with {company}: {topic}', { firstName: 'Jane', agentName: 'Cody', company: 'AIL', topic: 'life insurance' }), 'Hi Jane, Cody with AIL: life insurance');
  assert.match(context.smsLink('(314) 555-0100', 'A & B?', true), /^sms:3145550100&body=A%20%26%20B%3F$/);
  assert.throws(() => context.smsLink('123', 'hello'), /valid mobile/);
});
function prepare(h) {
  const consent = h.all().find(n => n.textContent?.startsWith('I have permission')).children[0];
  consent.checked = true;
  h.find('Open in Messages').events.click({ preventDefault() { assert.fail('draft should open'); } });
}
test('opening a text does not count a send or call; confirming sends only one Phone 2 registration', async () => {
  const h = harness(); prepare(h);
  assert.equal(h.calls.length, 0);
  assert.equal(h.state().records.length, 0);
  assert.equal(h.state().pending['2'].leadId, '123');
  const confirm = h.find('I sent it');
  await confirm.events.click();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].slot, '2');
  assert.equal(h.state().records.length, 1);
  assert.ok(h.state().records[0].sentAt);
  assert.equal(h.find('Text saved').disabled, true);
  await h.find('Text saved').events.click();
  assert.equal(h.calls.length, 1);
});
test('a changed lead never gets the previous draft registered against it', async () => {
  const h = harness(); prepare(h); h.move();
  await h.find('I sent it').events.click();
  assert.equal(h.calls.length, 0);
  assert.equal(h.state().records.length, 1, 'the confirmed text still saves against the original lead');
});
test('draft and duplicate protection survive reload, and stats exclude unsent drafts', async () => {
  const h = harness(); prepare(h); h.mode.sync(true);
  await h.find('I sent it').events.click();
  h.find('Done with this text').events.click();
  const consent = h.all().find(n => n.textContent?.startsWith('I have permission')).children[0]; consent.checked = true;
  let prevented = false;
  h.find('Open in Messages').events.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  const record = h.state().records[0];
  const stats = h.context.textStats([record, { ...record, sentAt: null }], record.experiment);
  assert.equal(stats.reduce((sum, row) => sum + row.sent, 0), 1);
});

test('message action includes recipient and edited draft, with setup below the primary action', () => {
  const h = harness();
  const link = h.find('Open in Messages');
  const setup = h.root.children.find(n => n.tag === 'details');
  assert.ok(h.root.children.indexOf(link) < h.root.children.indexOf(setup));
  prepare(h);
  assert.match(link.href, /^sms:3145550100&body=/);
  assert.equal(decodeURIComponent(link.href.split('&body=')[1]), h.state().pending['2'].body);
  const actual = h.all().find(n => n.tag === 'textarea');
  actual.value = 'Updated message & next steps';
  const reopen = h.find('Open in Messages');
  reopen.events.click();
  assert.equal(reopen.href, 'sms:3145550100&body=Updated%20message%20%26%20next%20steps');
});

test('natural message defaults normalize names and upgrade saved original templates', () => {
  const { context: c } = harness();
  assert.equal(c.textFirstName('DOE, ANNE-MARIE'), 'Anne-Marie');
  assert.equal(c.textFirstName('McKenzie Smith'), 'McKenzie');
  for (const type of ['Child Safe Kit', 'ChildSafe', 'Will Kit', 'Response Card']) {
    const templates = c.textTemplates(type);
    assert.doesNotMatch(templates.A + templates.B, /STOP|opt out/i);
    assert.match(templates.A, /Zoom meeting/);
    assert.match(templates.B, /Zoom meeting/);
    if (/Child/.test(type)) assert.match(templates.A, /American Income Life with the Child Safe Program/);
  }
  const old = 'Hi {firstName}, this is {agentName} with {company}. I am reaching out about {topic}. Is there a good time for a brief conversation? Reply STOP to opt out.';
  assert.equal(c.textTemplates('Child Safe Kit', {A:old}).A, c.textTemplates('Child Safe Kit').A);
  assert.equal(c.textTemplates('General', {A:'My custom wording'}).A, 'My custom wording');
});
