const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../phone-web/public/texting-mode.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function harness(options = {}) {
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
  const mode = context.createTextingMode(root, { storage, getUser: () => 'user', getSlot: () => '2', getLead: () => lead, getAgent: () => 'Cody', getMeetings: async () => [], openMessage: () => {}, tracking: { save: async () => {}, list: async () => [], checkin: async () => null }, registerCall: async draft => { calls.push(draft); return true; }, ...options });
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
  assert.throws(() => context.smsLink('123', 'hello'), /valid phone/);
});
async function prepare(h) {
  await h.find('Open in Messages').events.click({ preventDefault() {} });
}
test('opening a text does not count a send or call; confirming sends only one Phone 2 registration', async () => {
  const h = harness(); await prepare(h);
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
  const h = harness(); await prepare(h); h.move();
  await h.find('I sent it').events.click();
  assert.equal(h.calls.length, 0);
  assert.equal(h.state().records.length, 1, 'the confirmed text still saves against the original lead');
});
test('draft and duplicate protection survive reload, and stats exclude unsent drafts', async () => {
  const h = harness(); await prepare(h); h.mode.sync(true);
  await h.find('I sent it').events.click();
  h.find('Done with this text').events.click();
  let prevented = false;
  await h.find('Open in Messages').events.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  const record = h.state().records[0];
  const stats = h.context.textStats([record, { ...record, sentAt: null }], record.experiment);
  assert.equal(stats.reduce((sum, row) => sum + row.sent, 0), 1);
});

test('message action includes recipient and edited draft, with setup below the primary action', async () => {
  const h = harness();
  const link = h.find('Open in Messages');
  const setup = h.root.children.find(n => n.tag === 'details');
  assert.ok(h.root.children.indexOf(link) < h.root.children.indexOf(setup));
  await prepare(h);
  assert.match(link.href, /^sms:3145550100&body=/);
  assert.equal(decodeURIComponent(link.href.split('&body=')[1]), h.state().pending['2'].body);
  const actual = h.all().find(n => n.tag === 'textarea');
  actual.value = 'Updated message & next steps';
  const reopen = h.find('Open in Messages');
  await reopen.events.click({ preventDefault() {} });
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

test('meeting offers skip overlaps and all-day meetings but ignore callbacks', () => {
 const {context:c} = harness();
 const now = new Date(2026,9,1,12).getTime();
 const at = (hour,minute=0) => new Date(2026,9,1,hour,minute).toISOString();
 const rows = [{kind:'appointment',starts_at:at(14,30)}, {kind:'callback',starts_at:at(16)}];
 const slots = c.availableTextMeetings(rows,now);
 assert.deepEqual(Array.from(slots, t=>new Date(t).getHours()),[16,17]);
 const tomorrow = c.availableTextMeetings([{kind:'appointment',starts_at:at(0),all_day:true}],now);
 assert.equal(new Date(tomorrow[0]).getDate(),2);
 assert.equal(new Date(tomorrow[0]).getHours(),14);
 assert.ok(c.availableTextMeetings([],new Date(2026,9,1,19).getTime()).every(t=>new Date(t).getDate()>1));
});

test('assumptive draft uses checked calendar times and blocks opening on calendar failure', async () => {
 let opened = '', reads = 0;
 const h = harness({getMeetings: async () => { reads++; return []; }, openMessage: href => {opened=href;}});
 const state=h.state();
 state.templates['Response Card']={A:'I have {meetingTimeA} or {meetingTimeB} open for Zoom.',B:'I have {meetingTimeA} or {meetingTimeB} open for Zoom.',topic:'insurance'};
 h.storage.setItem('impact.texting.v1.user',JSON.stringify(state)); h.mode.sync(true);
 await prepare(h);
 assert.ok(reads >= 2, "preview loads availability and opening rechecks it");
 assert.equal(h.state().pending['2'].offeredSlots.length,2);
 assert.doesNotMatch(decodeURIComponent(opened), /checking available|meetingTime/);
 const failed=harness({getMeetings: async()=>{throw new Error('Calendar unavailable');},openMessage:()=>assert.fail('must not open unchecked offer')});
 const failState=failed.state(); failState.templates=state.templates;
 failed.storage.setItem('impact.texting.v1.user',JSON.stringify(failState)); failed.mode.sync(true);
 await prepare(failed);
 assert.equal(failed.state().pending['2'],undefined);
 assert.ok(failed.find('Calendar unavailable'));
});

test('drafts omit organization names from saved company settings and literal wording', () => {
 const {context:c} = harness();
 assert.equal(c.fillText('Hi Jane, Cody with {company}.', {company:'American Income Life — Schaefer Organization'}), 'Hi Jane, Cody with American Income Life.');
 assert.equal(c.fillText('Cody from American Income Life - Schaefer Organization.', {}), 'Cody from American Income Life.');
});

test('assumptive preview resolves actual dates and times before opening Messages', async () => {
 const h=harness(); const state=h.state();
 state.templates['Response Card']={A:'Zoom at {meetingTimeA} or {meetingTimeB}?', B:'Zoom at {meetingTimeA} or {meetingTimeB}?', topic:'insurance'};
 h.storage.setItem('impact.texting.v1.user',JSON.stringify(state)); h.mode.sync(true);
 await new Promise(resolve=>setImmediate(resolve));
 const preview=h.all().find(n=>n.className==='textingPreview');
 assert.match(preview.value, /Zoom at .+\d.+ or .+\d/);
 assert.doesNotMatch(preview.value, /checking|meetingTime/i);
 assert.equal(h.state().pending['2'],undefined);
 assert.ok(h.find('Copy message'));
});

test('Home-only leads can open a text and register against the Home number', async () => {
 let opened='';
 const h=harness({getLead:()=>({available:true,leadId:'home-lead',leadName:'DOE, JANE',phones:[{label:'Home',number:'3145550123'}]}),openMessage:href=>{opened=href;}});
 await prepare(h);
 assert.match(opened,/^sms:3145550123/);
 assert.equal(h.state().pending['2'].phoneType,'Home');
 await h.find('I sent it').events.click();
 assert.equal(h.calls[0].phoneType,'Home');
 assert.equal(h.calls[0].number,'3145550123');
});
test('number picker defaults to Mobile but allows selecting Home', async () => {
 const h=harness({getLead:()=>({available:true,leadId:'both',leadName:'Jane',phones:[{label:'Home',number:'3145550123'},{label:'Mobile',number:'3145550100'}]})});
 const picker=h.all().find(n=>n.tag==='select');
 assert.equal(picker.value,'3145550100');
 picker.value='3145550123';
 await prepare(h);
 assert.equal(h.state().pending['2'].number,'3145550123');
 assert.equal(h.state().pending['2'].phoneType,'Home');
});
